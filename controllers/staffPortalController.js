/**
 * Staff portal — what a staff member sees through their personal link.
 * (Most actions reuse the existing controllers; these are the reads that
 * must be scoped to "me".)
 */
const mongoose = require("mongoose");
const Schedule = require("../models/scheduleModel");
const Message = require("../models/messageModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const { hasFeature } = require("../config/plans");
const { getWeekSettings } = require("../utils/weekService");
const {
  weekStartFor,
  weekBounds,
  addDaysToKey,
} = require("../utils/dateUtils");
const {
  getCompatibleFacilityConfig,
  eligibleStaffForCoverage,
} = require("../utils/eligibility");

const SHIFT_FIELDS =
  "role unitArea shiftType shiftTag startTime endTime status state notes coverageId";

/**
 * GET /s/:token/me
 */
exports.getMe = async (req, res, next) => {
  try {
    const { timezone, weekStartsOn } = await getWeekSettings(req.tenantId);
    const prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId })
      .select("timeTracking.enabled")
      .lean();
    const planKey = req.plan.key;
    res.json({
      staff: {
        _id: req.user._id,
        name: req.user.name,
        roles: req.user.roles,
        hasPhone: Boolean(req.user.phoneE164),
        hasEmail: Boolean(req.user.email),
        smsStatus: req.user.smsConsent?.status || "none",
      },
      facility: {
        name: req.tenant.name,
        timezone,
        weekStartsOn,
        currentWeekStart: weekStartFor(new Date(), timezone, weekStartsOn),
      },
      features: {
        swaps: hasFeature(planKey, "swaps"),
        pickup: hasFeature(planKey, "pickup"),
        timeOff: true,
        preferences: true,
        messages: hasFeature(planKey, "messaging"),
        clockIn:
          hasFeature(planKey, "timeClock") && Boolean(prefs?.timeTracking?.enabled),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /s/:token/schedule?weekStart=YYYY-MM-DD   (default: this week + next 3)
 *     or ?from=ISO&to=ISO
 * Only my published shifts.
 */
exports.getMySchedule = async (req, res, next) => {
  try {
    const { timezone, weekStartsOn } = await getWeekSettings(req.tenantId);
    let from;
    let to;
    if (req.query.from || req.query.to) {
      from = req.query.from ? new Date(req.query.from) : new Date();
      to = req.query.to
        ? new Date(req.query.to)
        : new Date(from.getTime() + 28 * 86400000);
    } else {
      const start =
        req.query.weekStart || weekStartFor(new Date(), timezone, weekStartsOn);
      const weeks = Math.min(Math.max(Number(req.query.weeks) || 4, 1), 8);
      from = weekBounds(start, timezone).start;
      to = weekBounds(addDaysToKey(start, 7 * (weeks - 1)), timezone).end;
    }
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return res.status(400).json({ message: "Invalid date range" });
    }

    const shifts = await Schedule.find({
      tenantId: req.tenantId,
      staffId: req.user._id,
      state: "published",
      startTime: { $lt: to },
      endTime: { $gt: from },
    })
      .select(SHIFT_FIELDS)
      .sort({ startTime: 1 })
      .lean();

    res.json({ timezone, from, to, shifts });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /s/:token/swap-candidates/:scheduleId
 * Coworkers who could take my shift (names only).
 */
exports.getSwapCandidates = async (req, res, next) => {
  try {
    const { scheduleId } = req.params;
    if (!mongoose.isValidObjectId(scheduleId)) {
      return res.status(404).json({ message: "Shift not found" });
    }
    const shift = await Schedule.findOne({
      _id: scheduleId,
      tenantId: req.tenantId,
      staffId: req.user._id,
      state: "published",
      status: "scheduled",
    }).lean();
    if (!shift) return res.status(404).json({ message: "Shift not found" });

    const prefs = await FacilityPreferences.findOne({
      tenantId: req.tenantId,
    }).lean();
    const candidates = await eligibleStaffForCoverage({
      tenantId: req.tenantId,
      coverage: {
        _id: shift.coverageId || shift._id,
        role: shift.role,
        unitArea: shift.unitArea,
        shiftType: shift.shiftType,
        shiftTag: shift.shiftTag,
        startTime: shift.startTime,
        endTime: shift.endTime,
        requiredCertificationTags: [],
      },
      facilityConfig: getCompatibleFacilityConfig(prefs),
      excludeStaffIds: [req.user._id],
    });

    res.json(
      candidates
        .filter((row) => row.eligible)
        .map((row) => ({ staffId: row.staff._id, name: row.staff.name })),
    );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /s/:token/messages  — messages sent to me (Facility plan).
 */
exports.getMyMessages = async (req, res, next) => {
  try {
    const messages = await Message.find({
      tenantId: req.tenantId,
      receiverId: req.user._id,
    })
      .populate("senderId", "name")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json(messages);
  } catch (err) {
    next(err);
  }
};
