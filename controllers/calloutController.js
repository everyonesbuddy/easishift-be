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
const { sendCalloutOffer, remainingFor } = require("../utils/callouts");

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
    if (new Date(schedule.endTime) <= new Date()) {
      return res.status(400).json({ message: "This shift has already ended" });
    }

    if (schedule.status !== "call_out") {
      schedule.status = "call_out";
      schedule.meta = schedule.meta || {};
      schedule.meta.calledOutAt = new Date();
      schedule.meta.callOutReason = String(req.body?.reason || "").trim().slice(0, 300);
      await schedule.save();
    }

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

    // One open offer per slot: close the old one.
    await CalloutOffer.updateMany(
      { tenantId: req.tenantId, coverageId: coverage._id, status: "open" },
      { $set: { status: "cancelled" } },
    );

    const offer = await sendCalloutOffer({
      tenant: req.tenant,
      coverage,
      people: chosen.map((row) => row.staff),
      createdBy: req.user._id,
      timezone: settings.timezone,
    });

    res.status(201).json({
      offerId: offer._id,
      sentTo: offer.recipients.filter((r) => r.channel).length,
      bySms: offer.recipients.filter((r) => r.channel === "sms").length,
      byEmail: offer.recipients.filter((r) => r.channel === "email").length,
      notReached: offer.recipients
        .filter((r) => !r.channel)
        .map((r) => ({ staffId: r.staffId, name: r.name, reason: r.notReachedReason })),
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
