/**
 * Weeks — everything the schedule screen needs in one call.
 *
 * GET /api/v1/weeks/current                      -> { weekStart }
 * GET /api/v1/weeks/:weekStart                   -> week, coverage, schedules, staff, time off
 * GET /api/v1/weeks/:weekStart/candidates?coverageId=  -> who can take a slot
 */
const mongoose = require("mongoose");
const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const TimeOff = require("../models/timeOffModel");
const User = require("../models/userModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const Preferences = require("../models/preferencesModel");
const { getEffectivePlanKey } = require("../config/plans");
const { assertNotOverLimit } = require("../utils/planLimits");
const {
  sendToStaff,
  shortShift,
  shortWeek,
  firstName,
  escapeHtml,
} = require("../utils/notify");

// Staff links arrive in Stage 6; until then messages carry no link.
let linkForStaff = async () => null;
try {
  // eslint-disable-next-line global-require
  const staffLinks = require("../utils/staffLinks");
  linkForStaff = (person) => staffLinks.getStaffLinkUrl(person);
} catch (err) {
  if (err.code !== "MODULE_NOT_FOUND") throw err;
}
const { countAssignmentsByCoverage } = require("../utils/scheduleUtils");
const {
  dateKeyToCoverageDate,
  coverageDateToKey,
  weekDays,
  weekBounds,
  weekStartFor,
  addDaysToKey,
} = require("../utils/dateUtils");
const { getWeekSettings, ensureWeek } = require("../utils/weekService");
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

    // Over the plan's limits (e.g. trial ended with 40 staff): no new weeks.
    await assertNotOverLimit(req);

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
    week.publishedAt = now;
    week.publishedBy = req.user._id;
    week.lastPublish = { sms: sent.sms, email: sent.email, notReached };
    await week.save();

    res.json({
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
