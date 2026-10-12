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
