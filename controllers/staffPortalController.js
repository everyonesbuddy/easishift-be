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
    const pinSet = Boolean(req.user.linkPinSetAt);
    if (req.pinLocked) {
      // Before the PIN: just enough to greet them.
      return res.json({
        locked: true,
        pin: { required: true, set: pinSet },
        staff: { firstName: String(req.user.name || "").split(" ")[0] },
        facility: { name: req.tenant.name },
      });
    }
    const { timezone, weekStartsOn } = await getWeekSettings(req.tenantId);
    const prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId })
      .select("timeTracking.enabled")
      .lean();
    const planKey = req.plan.key;
    res.json({
      locked: false,
      pin: { required: Boolean(req.pinRequired), set: pinSet },
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
 *     or ?from=ISO&to=ISO (past shifts too; up to ~3 months per request)
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
    // One request covers at most ~3 months (the page loads history in steps).
    const MAX_RANGE_MS = 92 * 86400000;
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      from = new Date(to.getTime() - MAX_RANGE_MS);
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
 * GET /s/:token/messages  — messages sent to me (paid plans).
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


/**
 * POST /s/:token/pin/setup { pin }  — first time: choose a 4-digit PIN.
 * POST /s/:token/pin/verify { pin } — on a new device: enter it.
 * Both return { deviceToken } for the browser to keep.
 * POST /s/:token/pin/sign-out       — forget this device.
 */
const User = require("../models/userModel");
const pins = require("../utils/staffDevices");

exports.setupPin = async (req, res, next) => {
  try {
    if (!req.pinRequired) return res.status(400).json({ message: "This facility doesn't use PINs." });
    const { pin } = req.body || {};
    if (!pins.isValidPin(pin)) return res.status(400).json({ message: "Choose a 4-digit PIN." });
    // Only the very first time; afterwards changing it needs the scheduler.
    const result = await User.updateOne(
      { _id: req.user._id, tenantId: req.tenantId, linkPinSetAt: null },
      {
        $set: {
          linkPinHash: await pins.hashPin(pin),
          linkPinSetAt: new Date(),
          linkPinFailures: 0,
          linkPinLockedUntil: null,
        },
      },
    );
    if (!result.modifiedCount) {
      return res.status(409).json({ message: "A PIN is already set. Enter it instead.", errorCode: "PIN_ALREADY_SET" });
    }
    const deviceToken = await pins.createDevice({
      tenantId: req.tenantId,
      staffId: req.user._id,
      userAgent: req.get("user-agent"),
    });
    res.json({ deviceToken });
  } catch (err) {
    next(err);
  }
};

exports.verifyPin = async (req, res, next) => {
  try {
    if (!req.pinRequired) return res.status(400).json({ message: "This facility doesn't use PINs." });
    const { pin } = req.body || {};
    const user = await User.findOne({ _id: req.user._id, tenantId: req.tenantId }).select(
      "+linkPinHash linkPinSetAt linkPinFailures linkPinLockedUntil",
    );
    if (!user?.linkPinSetAt) {
      return res.status(409).json({ message: "No PIN yet. Choose one first.", errorCode: "PIN_NOT_SET" });
    }
    if (user.linkPinLockedUntil && user.linkPinLockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.linkPinLockedUntil.getTime() - Date.now()) / 60000);
      return res.status(429).json({
        message: `Too many tries. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or ask your scheduler to reset your PIN.`,
        errorCode: "PIN_LOCKED",
      });
    }
    const ok = pins.isValidPin(pin) && (await pins.checkPin(pin, user.linkPinHash));
    if (!ok) {
      const failures = (user.linkPinFailures || 0) + 1;
      const locked = failures >= pins.MAX_FAILURES;
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            linkPinFailures: locked ? 0 : failures,
            linkPinLockedUntil: locked ? new Date(Date.now() + pins.LOCK_MINUTES * 60000) : null,
          },
        },
      );
      return res.status(401).json({
        message: locked
          ? `Too many tries. Try again in ${pins.LOCK_MINUTES} minutes, or ask your scheduler to reset your PIN.`
          : "That PIN isn't right.",
        errorCode: locked ? "PIN_LOCKED" : "PIN_WRONG",
        attemptsLeft: locked ? 0 : pins.MAX_FAILURES - failures,
      });
    }
    await User.updateOne({ _id: user._id }, { $set: { linkPinFailures: 0, linkPinLockedUntil: null } });
    const deviceToken = await pins.createDevice({
      tenantId: req.tenantId,
      staffId: req.user._id,
      userAgent: req.get("user-agent"),
    });
    res.json({ deviceToken });
  } catch (err) {
    next(err);
  }
};

exports.signOutDevice = async (req, res, next) => {
  try {
    if (req.staffDevice) {
      await req.staffDevice.updateOne({ $set: { revokedAt: new Date() } });
    }
    res.json({ signedOut: true });
  } catch (err) {
    next(err);
  }
};
