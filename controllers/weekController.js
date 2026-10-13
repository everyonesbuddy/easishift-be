/**
 * Weeks — everything the schedule screen needs in one call.
 *
 * GET /api/v1/weeks/current                      -> { weekStart }
 * GET /api/v1/weeks/:weekStart                   -> week, coverage, schedules, staff, time off
 * GET /api/v1/weeks/:weekStart/candidates?coverageId=  -> who can take a slot
 * GET /api/v1/weeks?from=&to=                    -> summaries; opens each week (month/roster views)
 * POST /api/v1/weeks/:weekStart/slots            -> add a one-off need on one day
 */
const mongoose = require("mongoose");
const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const TimeOff = require("../models/timeOffModel");
const User = require("../models/userModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const { tagKey } = require("../utils/tagKey");
const Preferences = require("../models/preferencesModel");
const { getEffectivePlanKey } = require("../config/plans");
const {
  assertNotOverLimit,
  getUsage,
  canUseGraceWeek,
} = require("../utils/planLimits");
const {
  sendToStaff,
  shortShift,
  shortWeek,
  firstName,
  escapeHtml,
} = require("../utils/notify");

const { getStaffLinkUrl } = require("../utils/staffLinks");

const linkForStaff = (person) => getStaffLinkUrl(person);
const { countAssignmentsByCoverage } = require("../utils/scheduleUtils");
const {
  dateKeyToCoverageDate,
  coverageDateToKey,
  weekDays,
  weekBounds,
  weekStartFor,
  addDaysToKey,
} = require("../utils/dateUtils");
const {
  getWeekSettings,
  ensureWeek,
  buildTemplateOps,
  assertWeekStart,
} = require("../utils/weekService");
const { isDateKey, buildShiftSlotLookup } = require("../utils/dateUtils");
const {
  getCompatibleFacilityConfig,
  eligibleStaffForCoverage,
} = require("../utils/eligibility");

const STAFF_FIELDS =
  "name role roles allowedShiftTypes allowedAreas certificationTags phoneE164 email smsConsent";

const toWeekStaff = (person) => ({
  _id: person._id,
  name: person.name,
  roles: person.roles || [],
  allowedShiftTypes: person.allowedShiftTypes || [],
  allowedAreas: person.allowedAreas || [],
  certificationTags: person.certificationTags || [],
  hasPhone: Boolean(person.phoneE164),
  hasEmail: Boolean(person.email),
  smsStatus: person.smsConsent?.status || "none",
});

const toWeekResponse = (week) => ({
  _id: week._id,
  weekStart: coverageDateToKey(week.weekStart),
  status: week.status,
  publishedAt: week.publishedAt,
  lastPublish: week.lastPublish,
});

exports.getCurrentWeek = async (req, res, next) => {
  try {
    const { timezone, weekStartsOn } = await getWeekSettings(req.tenantId);
    const weekStart = weekStartFor(new Date(), timezone, weekStartsOn);
    res.json({
      weekStart,
      previous: addDaysToKey(weekStart, -7),
      next: addDaysToKey(weekStart, 7),
      timezone,
      weekStartsOn,
    });
  } catch (err) {
    next(err);
  }
};

exports.getWeek = async (req, res, next) => {
  try {
    const { weekStart } = req.params;
    const settings = await getWeekSettings(req.tenantId);
    const week = await ensureWeek({ tenantId: req.tenantId, weekStart, settings });

    const days = weekDays(weekStart);
    const { start, end } = weekBounds(weekStart, settings.timezone);

    const [coverage, schedules, staff, timeOff] = await Promise.all([
      Coverage.find({
        tenantId: req.tenantId,
        date: { $in: days.map(dateKeyToCoverageDate) },
      })
        .sort({ startTime: 1, role: 1 })
        .lean(),
      Schedule.find({
        tenantId: req.tenantId,
        startTime: { $gte: start, $lt: end },
      })
        .populate("staffId", "name roles")
        .sort({ startTime: 1 })
        .lean(),
      User.find({
        tenantId: req.tenantId,
        loginEnabled: false,
        status: "active",
      })
        .select(STAFF_FIELDS)
        .sort({ name: 1 })
        .lean(),
      TimeOff.find({
        tenantId: req.tenantId,
        status: { $in: ["pending", "approved"] },
        startTime: { $lt: end },
        endTime: { $gt: start },
      })
        .populate("staffId", "name")
        .lean(),
    ]);

    const assigned = await countAssignmentsByCoverage({
      tenantId: req.tenantId,
      coverageIds: coverage.map((row) => row._id),
    });

    let openSlots = 0;
    const coverageRows = coverage.map((row) => {
      const assignedCount = assigned.get(String(row._id)) || 0;
      const remaining = Math.max(0, row.requiredCount - assignedCount);
      openSlots += remaining;
      return {
        ...row,
        dateKey: coverageDateToKey(row.date),
        assignedCount,
        remaining,
      };
    });

    res.json({
      week: toWeekResponse(week),
      timezone: settings.timezone,
      days,
      coverage: coverageRows,
      schedules,
      staff: staff.map(toWeekStaff),
      timeOff,
      counts: {
        openSlots,
        shifts: schedules.filter((s) => s.status !== "call_out").length,
        callOuts: schedules.filter((s) => s.status === "call_out").length,
        unpublishedChanges: schedules.filter((s) => s.state === "draft").length,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getCandidates = async (req, res, next) => {
  try {
    const { weekStart } = req.params;
    const { coverageId } = req.query;
    if (!coverageId || !mongoose.isValidObjectId(coverageId)) {
      return res.status(400).json({ message: "Valid coverageId is required" });
    }

    const settings = await getWeekSettings(req.tenantId);
    await ensureWeek({ tenantId: req.tenantId, weekStart, settings });

    const [coverage, prefs] = await Promise.all([
      Coverage.findOne({ _id: coverageId, tenantId: req.tenantId }).lean(),
      FacilityPreferences.findOne({ tenantId: req.tenantId }).lean(),
    ]);
    if (!coverage) return res.status(404).json({ message: "Coverage not found" });

    const { start, end } = weekBounds(weekStart, settings.timezone);
    const candidates = await eligibleStaffForCoverage({
      tenantId: req.tenantId,
      coverage,
      facilityConfig: getCompatibleFacilityConfig(prefs),
      weekStart: start,
      weekEnd: end,
      overtimeThresholdMinutes:
        (prefs?.weeklyOvertimeThresholdHours || 40) * 60,
    });

    res.json(
      candidates.map((row) => ({
        staffId: row.staff._id,
        name: row.staff.name,
        roles: row.staff.roles || [],
        eligible: row.eligible,
        reasons: row.reasons,
        weekHours: Math.round((row.weekMinutes / 60) * 10) / 10,
        overtimeIfAssigned: row.overtimeIfAssigned,
      })),
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/weeks/:weekStart/publish
 * Body: { includeEveryone?: boolean, resendAll?: boolean }
 *
 * Publishes the week's draft shifts and sends each person ONE message with
 * their shifts. Publishing again later only messages people whose shifts
 * changed since the last publish (unless resendAll).
 */
exports.publishWeek = async (req, res, next) => {
  try {
    const { weekStart } = req.params;
    const includeEveryone = req.body?.includeEveryone === true;
    const resendAll = req.body?.resendAll === true;

    // Over the plan's limits (e.g. trial ended with 40 staff): no new weeks,
    // except one grace week right after a trial ends.
    let usedGraceWeek = false;
    if ((await getUsage(req)).overLimit) {
      if (canUseGraceWeek(req.tenant, weekStart)) usedGraceWeek = true;
      else await assertNotOverLimit(req);
    }

    const settings = await getWeekSettings(req.tenantId);
    const week = await ensureWeek({ tenantId: req.tenantId, weekStart, settings });
    const { start, end } = weekBounds(weekStart, settings.timezone);
    const now = new Date();
    const firstPublish = week.status !== "published";
    const previousPublishedAt = week.publishedAt;

    const inWeek = {
      tenantId: req.tenantId,
      startTime: { $gte: start, $lt: end },
    };

    // Who has changes in this publish (drafts going live, or edits since).
    const changed = await Schedule.find({
      ...inWeek,
      $or: [
        { state: "draft" },
        ...(previousPublishedAt
          ? [{ updatedAt: { $gt: previousPublishedAt } }]
          : []),
      ],
    })
      .select("staffId")
      .lean();
    const changedStaffIds = new Set(changed.map((row) => String(row.staffId)));

    await Schedule.updateMany(
      { ...inWeek, state: "draft" },
      { $set: { state: "published", "meta.publishedAt": now } },
      // Going live isn't an edit; keep updatedAt so the next publish only
      // messages people whose shifts really changed.
      { timestamps: false },
    );

    const [shifts, staff] = await Promise.all([
      Schedule.find({ ...inWeek, state: "published", status: { $ne: "call_out" } })
        .sort({ startTime: 1 })
        .lean(),
      User.find({ tenantId: req.tenantId, loginEnabled: false, status: "active" })
        .lean(),
    ]);
    const shiftsByStaff = new Map();
    for (const shift of shifts) {
      const key = String(shift.staffId);
      if (!shiftsByStaff.has(key)) shiftsByStaff.set(key, []);
      shiftsByStaff.get(key).push(shift);
    }

    const recipients = staff.filter((person) => {
      const key = String(person._id);
      const hasShifts = shiftsByStaff.has(key);
      if (firstPublish || resendAll) return hasShifts || includeEveryone;
      return changedStaffIds.has(key);
    });

    const prefsByStaff = new Map(
      (
        await Preferences.find({
          tenantId: req.tenantId,
          staffId: { $in: recipients.map((p) => p._id) },
        })
          .select("staffId emailNotificationsEnabled smsNotificationsEnabled")
          .lean()
      ).map((pref) => [String(pref.staffId), pref]),
    );

    const facility = req.tenant.name;
    const weekLabel = shortWeek(weekStart);
    const planKey = getEffectivePlanKey(req.tenant);
    const sent = { sms: 0, email: 0 };
    const notReached = [];

    for (const person of recipients) {
      const myShifts = shiftsByStaff.get(String(person._id)) || [];
      const lines = myShifts.map((shift) =>
        shortShift(shift.startTime, shift.endTime, settings.timezone),
      );
      const link = await linkForStaff(person);
      const summary = !lines.length
        ? "you're not on the schedule"
        : lines.length <= 4
          ? lines.join("; ")
          : `${lines.length} shifts`;
      const sms = `Hi ${firstName(person.name)}, your ${facility} schedule for ${weekLabel}${firstPublish ? "" : " was updated"}: ${summary}.${link ? ` ${link}` : ""}`;
      const html = `
        <p>Hi ${escapeHtml(firstName(person.name))},</p>
        <p>Your ${escapeHtml(facility)} schedule for <strong>${escapeHtml(weekLabel)}</strong>${firstPublish ? " is ready" : " was updated"}:</p>
        ${lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "<p>You're not on the schedule this week.</p>"}
        ${link ? `<p><a href="${link}">See your schedule, swap or pick up shifts</a></p>` : ""}`;

      const result = await sendToStaff({
        tenant: req.tenant,
        planKey,
        staff: person,
        kind: "week_published",
        sms,
        emailSubject: `Your ${facility} schedule for ${weekLabel}`,
        emailHtml: html,
        refId: week._id,
        preferences: prefsByStaff.get(String(person._id)) || null,
      });
      if (result.delivered) sent[result.channel] += 1;
      else notReached.push({ staffId: person._id, name: person.name, reason: result.reason });
    }

    week.status = "published";
    // Stamp after all writes above so nothing from this publish counts as
    // "changed since publish" next time.
    week.publishedAt = new Date();
    week.publishedBy = req.user._id;
    week.lastPublish = { sms: sent.sms, email: sent.email, notReached };
    await week.save();

    if (usedGraceWeek && req.tenant.graceWeekStart !== weekStart) {
      req.tenant.graceWeekStart = weekStart;
      await req.tenant.save();
    }

    res.json({
      usedGraceWeek,
      week: toWeekResponse(week),
      firstPublish,
      messaged: recipients.length,
      sent,
      notReached,
    });
  } catch (err) {
    next(err);
  }
};

const MAX_RANGE_WEEKS = 8;

/**
 * GET /api/v1/weeks?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Opens every week touching the range (creating its open slots from the
 * template the first time) and returns one summary per week. Used by the
 * month and roster views so slots exist whatever view is opened.
 */
exports.getWeeksInRange = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!isDateKey(from) || !isDateKey(to) || to < from) {
      return res
        .status(400)
        .json({ message: "from and to must be YYYY-MM-DD, in order" });
    }
    const settings = await getWeekSettings(req.tenantId);
    const weekStarts = [];
    let key = weekStartFor(
      new Date(`${from}T12:00:00Z`),
      "UTC",
      settings.weekStartsOn,
    );
    while (key <= to) {
      weekStarts.push(key);
      if (weekStarts.length > MAX_RANGE_WEEKS) {
        return res.status(400).json({
          message: `Ask for at most ${MAX_RANGE_WEEKS} weeks at a time`,
        });
      }
      key = addDaysToKey(key, 7);
    }

    const weeks = [];
    for (const weekStart of weekStarts) {
      const week = await ensureWeek({
        tenantId: req.tenantId,
        weekStart,
        settings,
      });
      const coverage = await Coverage.find({
        tenantId: req.tenantId,
        date: { $in: weekDays(weekStart).map(dateKeyToCoverageDate) },
      })
        .select("requiredCount")
        .lean();
      const assigned = await countAssignmentsByCoverage({
        tenantId: req.tenantId,
        coverageIds: coverage.map((row) => row._id),
      });
      const openSlots = coverage.reduce(
        (sum, row) =>
          sum + Math.max(0, row.requiredCount - (assigned.get(String(row._id)) || 0)),
        0,
      );
      weeks.push({ ...toWeekResponse(week), openSlots });
    }
    res.json({ weeks });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/weeks/:weekStart/slots
 * Body: { date: YYYY-MM-DD, shiftType, shiftTag, role, unitArea?,
 *         requiredCertificationTags?, count = 1 }
 * Adds a one-off need on one day (e.g. an extra caregiver Friday). If the
 * same slot already exists, its count goes up. Marked as hand-edited so
 * Weekly Needs changes leave it alone.
 */
exports.addSlot = async (req, res, next) => {
  try {
    const { weekStart } = req.params;
    const body = req.body || {};
    const settings = await getWeekSettings(req.tenantId);
    assertWeekStart(weekStart, settings.weekStartsOn);
    if (!weekDays(weekStart).includes(body.date)) {
      return res
        .status(400)
        .json({ message: "date must be a day in this week (YYYY-MM-DD)" });
    }
    const count = body.count === undefined ? 1 : Number(body.count);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return res.status(400).json({ message: "count must be 1–50" });
    }

    const prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId })
      .select("roleFamilies shiftTypeDefinitions unitAreas certificationTags")
      .lean();
    const norm = (v) => String(v || "").trim().toLowerCase();
    const role = norm(body.role);
    if (!(prefs?.roleFamilies || []).map(norm).includes(role)) {
      return res.status(400).json({ message: `Unknown role '${body.role}'` });
    }
    // Areas and certifications must exist in facility preferences.
    const unitArea = body.unitArea ? tagKey(body.unitArea) : null;
    if (unitArea && !(prefs?.unitAreas || []).map(tagKey).includes(unitArea)) {
      return res.status(400).json({ message: `Unknown unit area '${body.unitArea}'. Add it in Facility Preferences first.` });
    }
    const certs = Array.isArray(body.requiredCertificationTags)
      ? Array.from(new Set(body.requiredCertificationTags.map(tagKey).filter(Boolean)))
      : [];
    const knownCerts = (prefs?.certificationTags || []).map(tagKey);
    const unknownCert = certs.find((c) => !knownCerts.includes(c));
    if (unknownCert) {
      return res.status(400).json({ message: `Unknown certification '${unknownCert}'. Add it in Facility Preferences first.` });
    }

    await ensureWeek({ tenantId: req.tenantId, weekStart, settings });

    const weekday = new Date(`${body.date}T12:00:00Z`).getUTCDay();
    const countsByWeekday = [0, 0, 0, 0, 0, 0, 0];
    countsByWeekday[weekday] = count;
    const [op] = buildTemplateOps({
      tenantId: req.tenantId,
      rules: [
        {
          shiftType: norm(body.shiftType),
          shiftTag: norm(body.shiftTag),
          role,
          unitArea,
          requiredCertificationTags: certs,
          countsByWeekday,
        },
      ],
      dayKeys: [body.date],
      slotLookup: buildShiftSlotLookup(prefs),
      timezone: settings.timezone,
    });
    if (!op) {
      return res.status(400).json({
        message: `Unknown shift '${body.shiftType}:${body.shiftTag}'. Add it under shift times first.`,
      });
    }

    const existing = await Coverage.findOne(op.filter);
    let row;
    if (existing) {
      existing.requiredCount = Math.min(50, existing.requiredCount + count);
      existing.overridden = true;
      row = await existing.save();
    } else {
      row = await Coverage.create({
        ...op.filter,
        requiredCount: count,
        requiredCertificationTags: certs,
        source: "manual",
        overridden: true,
      });
    }
    res.status(existing ? 200 : 201).json({
      ...row.toObject(),
      dateKey: coverageDateToKey(row.date),
    });
  } catch (err) {
    if (err && err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ message: err.message, errorCode: err.errorCode });
    }
    next(err);
  }
};
