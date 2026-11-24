/**
 * Call-outs (scheduler side)
 * --------------------------
 * POST /api/v1/schedules/:id/call-out        mark someone out; returns who could cover
 * POST /api/v1/coverage/:id/fill-by-text     text eligible staff, first YES wins (paid plans)
 * GET  /api/v1/coverage/:id/callout          latest offer and who answered
 */
const mongoose = require("mongoose");
const Schedule = require("../models/scheduleModel");
const Coverage = require("../models/coverageModel");
const ScheduleWeek = require("../models/scheduleWeekModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const CalloutOffer = require("../models/calloutOfferModel");
const TimeEntry = require("../models/timeEntryModel");
const { COVERAGE_OCCUPYING_STATUSES } = require("../utils/scheduleUtils");
const {
  getCompatibleFacilityConfig,
  eligibleStaffForCoverage,
} = require("../utils/eligibility");
const { getWeekSettings } = require("../utils/weekService");
const {
  weekStartFor,
  weekBounds,
  dateKeyToCoverageDate,
} = require("../utils/dateUtils");
const { sendCalloutOffer, remainingFor, rankForOffer, WAVE_MINUTES } = require("../utils/callouts");
const callouts = require("../utils/callouts");

/** What the website and app show after texting: who got it, how, who's still to come, who wasn't reached. */
function offerSummary(offer, { rest = false } = {}) {
  return {
    offerId: offer._id,
    sentTo: offer.recipients.filter((r) => r.channel).length,
    queued: offer.recipients.filter((r) => !r.sentAt && !r.notReachedReason).length,
    waveSize: offer.waveSize || null,
    waveMinutes: offer.waveSize ? WAVE_MINUTES : null,
    bySms: offer.recipients.filter((r) => r.channel === "sms").length,
    byEmail: offer.recipients.filter((r) => r.channel === "email").length,
    notReached: offer.recipients
      .filter((r) => !r.channel && r.notReachedReason)
      .map((r) => ({ staffId: r.staffId, name: r.name, reason: r.notReachedReason })),
    // true when "everyone now" sent the rest of an offer already going out
    rest,
  };
}

const loadCandidates = async ({ tenantId, coverage }) => {
  const [prefs, settings] = await Promise.all([
    FacilityPreferences.findOne({ tenantId }).lean(),
    getWeekSettings(tenantId),
  ]);
  const weekStart = weekStartFor(coverage.startTime, settings.timezone, settings.weekStartsOn);
  const { start, end } = weekBounds(weekStart, settings.timezone);
  const candidates = await eligibleStaffForCoverage({
    tenantId,
    coverage,
    facilityConfig: getCompatibleFacilityConfig(prefs),
    weekStart: start,
    weekEnd: end,
    overtimeThresholdMinutes: (prefs?.weeklyOvertimeThresholdHours || 40) * 60,
  });
  return { candidates, prefs, settings, weekStart };
};

/** Staff ids who could take this shift now without overtime (for later call-out waves); null if it can't be worked out. */
exports.eligibleNow = async (tenantId, coverage) => {
  try {
    const { candidates } = await loadCandidates({ tenantId, coverage });
    return new Set(candidates.filter((r) => r.eligible && !r.overtimeIfAssigned).map((r) => String(r.staff._id)));
  } catch {
    return null;
  }
};

/** Who could take this shift without going into overtime, for the call-out text to managers. */
exports.coverCount = async (tenantId, coverage) => {
  try {
    const { candidates } = await loadCandidates({ tenantId, coverage });
    return candidates.filter((r) => r.eligible && !r.overtimeIfAssigned).length;
  } catch {
    return null;
  }
};

const toCandidate = (row) => ({
  staffId: row.staff._id,
  name: row.staff.name,
  eligible: row.eligible,
  reasons: row.reasons,
  weekHours: Math.round((row.weekMinutes / 60) * 10) / 10,
  overtimeIfAssigned: row.overtimeIfAssigned,
  hasPhone: Boolean(row.staff.phoneE164),
  smsStatus: row.staff.smsConsent?.status || "none",
});

const AFTER_SHIFT_DAYS = 30;
// Statuses an ended shift can be changed from: closed out as a no-show, or as
// completed when time tracking is off (nobody actually confirmed they worked).
const AFTER_SHIFT_FROM = new Set(["scheduled", "no_show", "completed"]);

exports.markCallOut = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Schedule not found" });
    }
    const schedule = await Schedule.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });

    // After the fact: they called the scheduler, who didn't get to mark it in
    // time. The shift is over (often closed out as a no-show), so just record
    // the call-out; there's nobody to find for it any more.
    const ended = new Date(schedule.endTime) <= new Date();
    if (ended) {
      if (Date.now() - new Date(schedule.endTime).getTime() > AFTER_SHIFT_DAYS * 86400000) {
        return res.status(400).json({ message: `Call-outs can be marked up to ${AFTER_SHIFT_DAYS} days after the shift` });
      }
      if (schedule.status !== "call_out" && !AFTER_SHIFT_FROM.has(schedule.status)) {
        return res.status(400).json({ message: "This shift was worked, so it can't be a call-out" });
      }
      if (schedule.status !== "call_out" && (await TimeEntry.exists({ tenantId: req.tenantId, scheduleId: schedule._id }))) {
        return res.status(400).json({ message: "They clocked in for this shift, so it can't be a call-out" });
      }
    }

    if (schedule.status !== "call_out") {
      schedule.meta = schedule.meta || {};
      schedule.meta.statusBeforeCallOut = schedule.status;
      schedule.status = "call_out";
      schedule.meta.calledOutAt = new Date();
      schedule.meta.callOutReason = String(req.body?.reason || "").trim().slice(0, 300);
      if (ended) schedule.meta.calloutMarkedAfterShift = true;
      schedule.markModified("meta");
      await schedule.save();
    }
    if (ended) return res.json({ schedule, coverage: null, candidates: [], afterShift: true });

    let coverage = schedule.coverageId
      ? await Coverage.findOne({ _id: schedule.coverageId, tenantId: req.tenantId }).lean()
      : null;
    if (!coverage) {
      return res.json({ schedule, coverage: null, candidates: [] });
    }
    const remaining = await remainingFor(coverage);
    const { candidates } = await loadCandidates({ tenantId: req.tenantId, coverage });

    res.json({
      schedule,
      coverage: { ...coverage, remaining },
      candidates: candidates.map(toCandidate),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Undo a call-out marked by mistake, before or after the shift: the person
 * goes back to how they were. If someone was added to the spot since and it's
 * full, nothing changes: the answer lists who, so the scheduler can choose to
 * keep them or remove them (that removal tells them) and undo again. Texts
 * still going out for a spot that's full again stop.
 */
exports.undoCallOut = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Schedule not found" });
    }
    const schedule = await Schedule.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!schedule) return res.status(404).json({ message: "Schedule not found" });
    if (schedule.status !== "call_out") return res.json({ schedule });
    schedule.meta = schedule.meta || {};
    const before = schedule.meta.statusBeforeCallOut;
    const next = before && before !== "call_out" ? before : "scheduled";

    const coverage = schedule.coverageId ? await Coverage.findOne({ _id: schedule.coverageId, tenantId: req.tenantId }).lean() : null;
    // Putting them back takes a place on the spot: is there still one?
    if (coverage && COVERAGE_OCCUPYING_STATUSES.includes(next) && (await remainingFor(coverage)) <= 0) {
      const since = schedule.meta.calledOutAt ? new Date(schedule.meta.calledOutAt) : null;
      const others = await Schedule.find({
        tenantId: req.tenantId,
        coverageId: coverage._id,
        _id: { $ne: schedule._id },
        status: { $in: COVERAGE_OCCUPYING_STATUSES },
      })
        .populate("staffId", "name")
        .lean();
      const added = since ? others.filter((o) => new Date(o.createdAt) >= since) : others;
      return res.status(409).json({
        message: added.length
          ? `${added.map((o) => o.staffId?.name || "Someone").join(" and ")} ${added.length === 1 ? "was" : "were"} added to cover this shift. Keep them, or remove them first to put this person back.`
          : "This spot is full now. Remove someone from it first to put this person back.",
        errorCode: "SPOT_FILLED",
        replacements: added.map((o) => ({ scheduleId: o._id, name: o.staffId?.name || "Someone" })),
      });
    }

    schedule.status = next;
    schedule.meta.calledOutAt = undefined;
    schedule.meta.callOutReason = undefined;
    schedule.meta.statusBeforeCallOut = undefined;
    schedule.meta.calloutMarkedAfterShift = undefined;
    schedule.markModified("meta");
    await schedule.save();

    // The spot is covered again: stop the "can you cover?" texts.
    let textsStopped = false;
    if (coverage && (await remainingFor(coverage)) <= 0) {
      const r = await CalloutOffer.updateMany({ tenantId: req.tenantId, coverageId: coverage._id, status: "open" }, { $set: { status: "cancelled" } });
      textsStopped = (r?.modifiedCount ?? r?.nModified ?? 0) > 0;
    }
    res.json({ schedule, textsStopped });
  } catch (err) {
    next(err);
  }
};

exports.fillByText = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Coverage not found" });
    }
    const coverage = await Coverage.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    }).lean();
    if (!coverage) return res.status(404).json({ message: "Coverage not found" });
    if (new Date(coverage.startTime) <= new Date()) {
      return res.status(400).json({ message: "This shift has already started" });
    }
    if ((await remainingFor(coverage)) <= 0) {
      return res.status(409).json({ message: "This shift is already full", errorCode: "SHIFT_ALREADY_FILLED" });
    }

    const { candidates, prefs, settings, weekStart } = await loadCandidates({
      tenantId: req.tenantId,
      coverage,
    });

    // Staff can only take shifts in published weeks.
    const week = await ScheduleWeek.findOne({
      tenantId: req.tenantId,
      weekStart: dateKeyToCoverageDate(weekStart),
    }).lean();
    if (!week || week.status !== "published") {
      return res.status(409).json({
        message: "Publish this week first so staff can take the shift",
        errorCode: "WEEK_NOT_PUBLISHED",
      });
    }

    const requested = Array.isArray(req.body?.staffIds)
      ? new Set(req.body.staffIds.map(String))
      : null;
    const skipOvertime = !requested && prefs?.excludeOvertimeOnCallout !== false;

    const chosen = candidates.filter(
      (row) =>
        row.eligible &&
        (!requested || requested.has(String(row.staff._id))) &&
        (!skipOvertime || !row.overtimeIfAssigned),
    );
    if (!chosen.length) {
      return res.status(409).json({
        message: "Nobody eligible is free for this shift",
        errorCode: "NO_ELIGIBLE_STAFF",
        candidates: candidates.map(toCandidate),
      });
    }

    // "Text everyone now" on an offer already going out in waves: send it to the
    // people still waiting, instead of starting over and texting the first ones twice.
    if (!requested && req.body?.everyone === true) {
      const open = await CalloutOffer.findOne({ tenantId: req.tenantId, coverageId: coverage._id, status: "open", expiresAt: { $gt: new Date() } });
      if (open && open.recipients.some((r) => !r.sentAt && !r.notReachedReason)) {
        await CalloutOffer.updateOne({ _id: open._id }, { $set: { nextWaveAt: null } });
        await callouts.sendWaiting(open, { all: true });
        return res.status(201).json({ ...offerSummary(open, { rest: true }), skippedForOvertime: 0 });
      }
    }

    // One open offer per slot: close the old one.
    await CalloutOffer.updateMany(
      { tenantId: req.tenantId, coverageId: coverage._id, status: "open" },
      { $set: { status: "cancelled" } },
    );

    // Most likely to say yes first. Unless the scheduler picked people or asked for everyone,
    // a few get it now and the rest in waves while it's still open: fewer texts, same fill.
    const ranked = await rankForOffer(coverage.tenantId, chosen);
    const offer = await sendCalloutOffer({
      tenant: req.tenant,
      coverage,
      people: ranked.map((row) => row.staff),
      createdBy: req.user._id,
      timezone: settings.timezone,
      waves: !requested && req.body?.everyone !== true,
    });

    res.status(201).json({
      ...offerSummary(offer),
      skippedForOvertime: skipOvertime
        ? candidates.filter((row) => row.eligible && row.overtimeIfAssigned).length
        : 0,
    });
  } catch (err) {
    next(err);
  }
};

exports.getCalloutStatus = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Coverage not found" });
    }
    const coverage = await Coverage.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    }).lean();
    if (!coverage) return res.status(404).json({ message: "Coverage not found" });

    const offer = await CalloutOffer.findOne({
      tenantId: req.tenantId,
      coverageId: coverage._id,
    })
      .sort({ createdAt: -1 })
      .populate("filledBy", "name")
      .lean();

    res.json({
      coverage: { ...coverage, remaining: await remainingFor(coverage) },
      offer,
    });
  } catch (err) {
    next(err);
  }
};
