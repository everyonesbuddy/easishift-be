const mongoose = require("mongoose");

const FacilityPreferences = require("../models/facilityPreferencesModel");
const Schedule = require("../models/scheduleModel");
const TimeEntry = require("../models/timeEntryModel");
const {
  getAttendanceOutcomeForClockOut,
} = require("../utils/timeTrackingAttendanceUtils");
const {
  evaluateGeofenceLocation,
  isGeofenceConfigured,
} = require("../utils/timeTrackingGeofenceUtils");

const DEFAULT_TIME_TRACKING = {
  enabled: false,
  mode: "open",
  clockInGraceMinutes: 15,
  clockOutGraceMinutes: 30,
  roundingMinutes: 0,
  autoCloseOpenBreakOnClockOut: true,
  geofenceRadiusMeters: 150,
  geofenceMaxAccuracyMeters: 50,
};

const toDateOrNow = (value) => {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const clampPositiveMinutes = (value, fallback) => {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber < 0) return fallback;
  return asNumber;
};

const applyRounding = (minutes, increment) => {
  if (!increment || increment <= 0) return minutes;
  return Math.round(minutes / increment) * increment;
};

const getOpenBreakIndex = (breaks) =>
  (Array.isArray(breaks) ? breaks : []).findIndex((item) => !item.endAt);

const normalizeTimeTrackingConfig = (prefs) => {
  const configured = prefs?.timeTracking || {};
  return {
    enabled:
      configured.enabled !== undefined
        ? Boolean(configured.enabled)
        : DEFAULT_TIME_TRACKING.enabled,
    mode: ["open", "geofence"].includes(configured.mode)
      ? configured.mode
      : DEFAULT_TIME_TRACKING.mode,
    geofence: {
      address:
        typeof configured.geofence?.address === "string"
          ? configured.geofence.address
          : "",
      latitude: Number.isFinite(configured.geofence?.latitude)
        ? configured.geofence.latitude
        : null,
      longitude: Number.isFinite(configured.geofence?.longitude)
        ? configured.geofence.longitude
        : null,
      radiusMeters: Number.isFinite(configured.geofence?.radiusMeters)
        ? configured.geofence.radiusMeters
        : DEFAULT_TIME_TRACKING.geofenceRadiusMeters,
      maxAccuracyMeters: Number.isFinite(configured.geofence?.maxAccuracyMeters)
        ? configured.geofence.maxAccuracyMeters
        : DEFAULT_TIME_TRACKING.geofenceMaxAccuracyMeters,
    },
    // Schedule matching is always enforced for clock-in.
    requireScheduleMatch: true,
    clockInGraceMinutes: clampPositiveMinutes(
      configured.clockInGraceMinutes,
      DEFAULT_TIME_TRACKING.clockInGraceMinutes,
    ),
    clockOutGraceMinutes: clampPositiveMinutes(
      configured.clockOutGraceMinutes,
      DEFAULT_TIME_TRACKING.clockOutGraceMinutes,
    ),
    roundingMinutes: [0, 5, 6, 10, 15].includes(configured.roundingMinutes)
      ? configured.roundingMinutes
      : DEFAULT_TIME_TRACKING.roundingMinutes,
    autoCloseOpenBreakOnClockOut: true,
  };
};

const getTimeTrackingConfig = async (tenantId) => {
  const prefs = await FacilityPreferences.findOne({ tenantId })
    .select("timeTracking")
    .lean();
  return normalizeTimeTrackingConfig(prefs);
};

const ensureTrackingEnabled = (config, res) => {
  if (config.enabled) return true;
  res.status(403).json({
    message: "Time tracking is disabled for this facility",
  });
  return false;
};

const ensureGeofenceConfigured = (config, res) => {
  if (config.mode !== "geofence" || isGeofenceConfigured(config.geofence)) {
    return true;
  }

  res.status(409).json({
    message: "Facility geofence is not configured",
    errorCode: "GEOFENCE_NOT_CONFIGURED",
  });
  return false;
};

const getGeofenceFailureStatus = (status) => {
  if (status === "outside") return 403;
  if (status === "inaccurate") return 422;
  return 400;
};

const syncScheduleAttendanceOutcome = async ({
  tenantId,
  scheduleId,
  clockOutAt,
  clockOutGraceMinutes,
}) => {
  if (!scheduleId || !clockOutAt) {
    return { attendanceOutcome: "completed", schedule: null };
  }

  const schedule = await Schedule.findOne({
    _id: scheduleId,
    tenantId,
    status: { $ne: "call_out" },
  }).select("endTime");

  if (!schedule) {
    return { attendanceOutcome: "completed", schedule: null };
  }

  const attendanceOutcome = getAttendanceOutcomeForClockOut({
    scheduledEndTime: schedule.endTime,
    clockOutAt,
    clockOutGraceMinutes,
  });

  await Schedule.updateOne(
    {
      _id: scheduleId,
      tenantId,
      status: { $ne: "call_out" },
    },
    {
      $set: {
        status: attendanceOutcome,
        ...(attendanceOutcome === "left_early"
          ? { "meta.leftEarlyAt": clockOutAt, "meta.completedAt": null }
          : { "meta.completedAt": clockOutAt, "meta.leftEarlyAt": null }),
      },
    },
  );

  return { attendanceOutcome, schedule };
};

const syncTimeEntryAttendanceOutcome = async ({
  tenantId,
  timeEntryId,
  clockOutAt,
  clockOutGraceMinutes,
}) => {
  if (!timeEntryId || !clockOutAt) {
    return { attendanceOutcome: "completed" };
  }

  const entry = await TimeEntry.findOne({
    _id: timeEntryId,
    tenantId,
    status: "in_progress",
  }).select("scheduleId clockOutAt attendanceOutcome");

  if (!entry) {
    return { attendanceOutcome: "completed" };
  }

  let attendanceOutcome = "completed";

  if (entry.scheduleId) {
    const syncResult = await syncScheduleAttendanceOutcome({
      tenantId,
      scheduleId: entry.scheduleId,
      clockOutAt,
      clockOutGraceMinutes,
    });
    attendanceOutcome = syncResult.attendanceOutcome;
  }

  await TimeEntry.updateOne(
    { _id: timeEntryId, tenantId, status: "in_progress" },
    {
      $set: {
        clockOutAt,
        status: "completed",
        attendanceOutcome,
      },
    },
  );

  return { attendanceOutcome };
};

const findScheduleForClockAction = async ({
  tenantId,
  staffId,
  at,
  scheduleId,
  clockInGraceMinutes,
  clockOutGraceMinutes,
}) => {
  const actionTime = new Date(at);
  const earlyBoundary = new Date(
    actionTime.getTime() + clockOutGraceMinutes * 60 * 1000,
  );
  const lateBoundary = new Date(
    actionTime.getTime() - clockInGraceMinutes * 60 * 1000,
  );

  const baseFilter = {
    tenantId,
    staffId,
    status: { $in: ["scheduled", "in_progress"] },
    startTime: { $lte: earlyBoundary },
    endTime: { $gte: lateBoundary },
  };

  if (scheduleId) {
    if (!mongoose.isValidObjectId(scheduleId)) return null;
    baseFilter._id = scheduleId;
  }

  return Schedule.findOne(baseFilter).sort({ startTime: -1 });
};

const computeTotals = (entry, roundingMinutes) => {
  if (!entry.clockOutAt || !entry.clockInAt) {
    return {
      grossMinutes: null,
      unpaidBreakMinutes: null,
      workedMinutes: null,
    };
  }

  const grossMinutesRaw =
    (new Date(entry.clockOutAt).getTime() -
      new Date(entry.clockInAt).getTime()) /
    60000;

  const unpaidBreakMinutesRaw = (entry.breaks || []).reduce((total, item) => {
    if (item.paid || !item.startAt || !item.endAt) return total;
    const duration =
      (new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) /
      60000;
    return total + Math.max(duration, 0);
  }, 0);

  const grossMinutes = Math.max(
    0,
    applyRounding(grossMinutesRaw, roundingMinutes),
  );
  const unpaidBreakMinutes = Math.max(
    0,
    applyRounding(unpaidBreakMinutesRaw, roundingMinutes),
  );
  const workedMinutes = Math.max(0, grossMinutes - unpaidBreakMinutes);

  return {
    grossMinutes,
    unpaidBreakMinutes,
    workedMinutes,
  };
};

exports.getMyTimeEntries = async (req, res, next) => {
  try {
    const filter = {
      tenantId: req.tenantId,
      staffId: req.user._id,
    };

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.from || req.query.to) {
      filter.clockInAt = {};
      if (req.query.from) filter.clockInAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.clockInAt.$lte = new Date(req.query.to);
    }

    const entries = await TimeEntry.find(filter)
      .sort({ clockInAt: -1 })
      .limit(200)
      .populate("scheduleId", "role startTime endTime status");

    res.json(entries);
  } catch (err) {
    next(err);
  }
};

exports.clockIn = async (req, res, next) => {
  try {
    const config = await getTimeTrackingConfig(req.tenantId);
    if (!ensureTrackingEnabled(config, res)) return;
    if (!ensureGeofenceConfigured(config, res)) return;

    const existing = await TimeEntry.findOne({
      tenantId: req.tenantId,
      staffId: req.user._id,
      status: "in_progress",
    });

    if (existing) {
      return res.status(409).json({
        message: "You already have an active time entry",
        activeTimeEntryId: existing._id,
      });
    }

    const clockInAt = toDateOrNow(req.body.at);
    if (!clockInAt) {
      return res.status(400).json({ message: "Invalid clock-in time" });
    }

    const locationCheck =
      config.mode === "geofence"
        ? evaluateGeofenceLocation({
            location: req.body.location,
            geofence: config.geofence,
          })
        : null;
    if (locationCheck && !locationCheck.accepted) {
      return res.status(getGeofenceFailureStatus(locationCheck.status)).json({
        message: locationCheck.message,
        errorCode: `GEOFENCE_${locationCheck.status.toUpperCase()}`,
        locationResult: locationCheck.status,
        distanceMeters: locationCheck.snapshot.distanceMeters,
        radiusMeters: config.geofence.radiusMeters,
      });
    }

    const schedule = await findScheduleForClockAction({
      tenantId: req.tenantId,
      staffId: req.user._id,
      at: clockInAt,
      scheduleId: req.body.scheduleId,
      clockInGraceMinutes: config.clockInGraceMinutes,
      clockOutGraceMinutes: config.clockOutGraceMinutes,
    });

    if (!schedule) {
      return res.status(409).json({
        message:
          "No matching scheduled shift found within configured grace window",
      });
    }

    const created = await TimeEntry.create({
      tenantId: req.tenantId,
      staffId: req.user._id,
      scheduleId: schedule ? schedule._id : null,
      clockInAt,
      mode: config.mode,
      clockInLocation: locationCheck?.snapshot,
      attendanceOutcome: "in_progress",
      source: ["mobile", "web", "admin"].includes(req.body.source)
        ? req.body.source
        : "mobile",
      notes: req.body.note || "",
    });

    if (schedule && schedule.status === "scheduled") {
      schedule.status = "in_progress";
      schedule.meta = {
        ...(schedule.meta || {}),
        clockedInAt: clockInAt,
      };
      await schedule.save();
    }

    const populated = await TimeEntry.findById(created._id).populate(
      "scheduleId",
      "role startTime endTime status",
    );

    res.status(201).json(populated);
  } catch (err) {
    if (err && err.code === 11000) {
      return res
        .status(409)
        .json({ message: "Active time entry already exists" });
    }
    next(err);
  }
};

exports.startBreak = async (req, res, next) => {
  try {
    const config = await getTimeTrackingConfig(req.tenantId);
    if (!ensureTrackingEnabled(config, res)) return;

    const entry = await TimeEntry.findOne({
      tenantId: req.tenantId,
      staffId: req.user._id,
      status: "in_progress",
    });

    if (!entry) {
      return res.status(404).json({ message: "No active time entry found" });
    }

    if (getOpenBreakIndex(entry.breaks) >= 0) {
      return res
        .status(409)
        .json({ message: "There is already an active break" });
    }

    const startAt = toDateOrNow(req.body.at);
    if (!startAt) {
      return res.status(400).json({ message: "Invalid break start time" });
    }

    if (startAt <= entry.clockInAt) {
      return res
        .status(400)
        .json({ message: "Break cannot start before clock in" });
    }

    entry.breaks.push({
      startAt,
      type: ["rest", "meal", "other"].includes(req.body.type)
        ? req.body.type
        : "rest",
      paid: Boolean(req.body.paid),
      source: ["mobile", "web", "admin"].includes(req.body.source)
        ? req.body.source
        : "mobile",
    });

    await entry.save();
    res.json(entry);
  } catch (err) {
    next(err);
  }
};

exports.endBreak = async (req, res, next) => {
  try {
    const config = await getTimeTrackingConfig(req.tenantId);
    if (!ensureTrackingEnabled(config, res)) return;

    const entry = await TimeEntry.findOne({
      tenantId: req.tenantId,
      staffId: req.user._id,
      status: "in_progress",
    });

    if (!entry) {
      return res.status(404).json({ message: "No active time entry found" });
    }

    const index = getOpenBreakIndex(entry.breaks);
    if (index < 0) {
      return res.status(409).json({ message: "No active break found" });
    }

    const endAt = toDateOrNow(req.body.at);
    if (!endAt) {
      return res.status(400).json({ message: "Invalid break end time" });
    }

    if (endAt <= entry.breaks[index].startAt) {
      return res.status(400).json({
        message: "Break end time must be after break start time",
      });
    }

    entry.breaks[index].endAt = endAt;
    await entry.save();

    res.json(entry);
  } catch (err) {
    next(err);
  }
};

exports.clockOut = async (req, res, next) => {
  try {
    const config = await getTimeTrackingConfig(req.tenantId);
    if (!ensureTrackingEnabled(config, res)) return;
    if (!ensureGeofenceConfigured(config, res)) return;

    const entry = await TimeEntry.findOne({
      tenantId: req.tenantId,
      staffId: req.user._id,
      status: "in_progress",
    });

    if (!entry) {
      return res.status(404).json({ message: "No active time entry found" });
    }

    const clockOutAt = toDateOrNow(req.body.at);
    if (!clockOutAt) {
      return res.status(400).json({ message: "Invalid clock-out time" });
    }

    if (clockOutAt <= entry.clockInAt) {
      return res.status(400).json({
        message: "Clock-out time must be after clock-in time",
      });
    }

    const locationCheck =
      config.mode === "geofence"
        ? evaluateGeofenceLocation({
            location: req.body.location,
            geofence: config.geofence,
          })
        : null;

    const openBreakIndex = getOpenBreakIndex(entry.breaks);
    if (openBreakIndex >= 0) {
      if (!config.autoCloseOpenBreakOnClockOut) {
        return res.status(409).json({
          message: "Cannot clock out with an active break",
        });
      }

      const breakStart = entry.breaks[openBreakIndex].startAt;
      entry.breaks[openBreakIndex].endAt =
        clockOutAt > breakStart
          ? clockOutAt
          : new Date(breakStart.getTime() + 1000);
    }

    entry.clockOutAt = clockOutAt;
    if (locationCheck) {
      entry.clockOutLocation = locationCheck.snapshot;
    }
    entry.status = "completed";
    if (req.body.note) {
      entry.notes = entry.notes
        ? `${entry.notes}\n${req.body.note}`
        : req.body.note;
    }

    entry.totals = computeTotals(entry, config.roundingMinutes);

    let attendanceOutcome = "completed";
    if (entry.scheduleId) {
      const syncResult = await syncScheduleAttendanceOutcome({
        tenantId: req.tenantId,
        scheduleId: entry.scheduleId,
        clockOutAt,
        clockOutGraceMinutes: config.clockOutGraceMinutes,
      });
      attendanceOutcome = syncResult.attendanceOutcome;
    }

    entry.attendanceOutcome = attendanceOutcome;

    await entry.save();

    const populated = await TimeEntry.findById(entry._id).populate(
      "scheduleId",
      "role startTime endTime status",
    );

    res.json(populated);
  } catch (err) {
    next(err);
  }
};

exports.listTimeEntries = async (req, res, next) => {
  try {
    const filter = {
      tenantId: req.tenantId,
    };

    if (req.query.staffId) {
      filter.staffId = req.query.staffId;
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.from || req.query.to) {
      filter.clockInAt = {};
      if (req.query.from) filter.clockInAt.$gte = new Date(req.query.from);
      if (req.query.to) filter.clockInAt.$lte = new Date(req.query.to);
    }

    const entries = await TimeEntry.find(filter)
      .sort({ clockInAt: -1 })
      .limit(500)
      .populate("staffId", "name email role")
      .populate("scheduleId", "role startTime endTime status");

    res.json(entries);
  } catch (err) {
    next(err);
  }
};

exports.adjustTimeEntry = async (req, res, next) => {
  try {
    const config = await getTimeTrackingConfig(req.tenantId);
    if (!ensureTrackingEnabled(config, res)) return;

    const entry = await TimeEntry.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!entry) {
      return res.status(404).json({ message: "Time entry not found" });
    }

    if (req.body.clockInAt) {
      const date = toDateOrNow(req.body.clockInAt);
      if (!date) return res.status(400).json({ message: "Invalid clockInAt" });
      entry.clockInAt = date;
    }

    if (req.body.clockOutAt) {
      const date = toDateOrNow(req.body.clockOutAt);
      if (!date) return res.status(400).json({ message: "Invalid clockOutAt" });
      entry.clockOutAt = date;
    }

    if (Array.isArray(req.body.breaks)) {
      const normalizedBreaks = [];
      for (const item of req.body.breaks) {
        const startAt = toDateOrNow(item.startAt);
        if (!startAt) {
          return res.status(400).json({ message: "Invalid break startAt" });
        }

        const endAt = item.endAt ? toDateOrNow(item.endAt) : null;
        if (item.endAt && !endAt) {
          return res.status(400).json({ message: "Invalid break endAt" });
        }

        if (endAt && endAt <= startAt) {
          return res.status(400).json({
            message: "Each break endAt must be after startAt",
          });
        }

        normalizedBreaks.push({
          startAt,
          endAt,
          type: ["rest", "meal", "other"].includes(item.type)
            ? item.type
            : "rest",
          paid: Boolean(item.paid),
          source: ["mobile", "web", "admin"].includes(item.source)
            ? item.source
            : "admin",
        });
      }

      normalizedBreaks.sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );

      for (let index = 1; index < normalizedBreaks.length; index += 1) {
        const previous = normalizedBreaks[index - 1];
        const current = normalizedBreaks[index];
        if (
          previous.endAt &&
          new Date(previous.endAt) > new Date(current.startAt)
        ) {
          return res.status(400).json({ message: "Breaks cannot overlap" });
        }
      }

      entry.breaks = normalizedBreaks;
    }

    if (req.body.note) {
      entry.notes = entry.notes
        ? `${entry.notes}\n${req.body.note}`
        : req.body.note;
    }

    if (entry.clockOutAt && entry.clockOutAt <= entry.clockInAt) {
      return res.status(400).json({
        message: "clockOutAt must be after clockInAt",
      });
    }

    entry.status = "adjusted";
    entry.adjustedBy = req.user._id;
    entry.adjustedAt = new Date();
    entry.totals = computeTotals(entry, config.roundingMinutes);

    if (entry.clockOutAt) {
      if (entry.scheduleId) {
        const syncResult = await syncScheduleAttendanceOutcome({
          tenantId: req.tenantId,
          scheduleId: entry.scheduleId,
          clockOutAt: entry.clockOutAt,
          clockOutGraceMinutes: config.clockOutGraceMinutes,
        });
        entry.attendanceOutcome = syncResult.attendanceOutcome;
      } else {
        entry.attendanceOutcome = "completed";
      }
    } else {
      entry.attendanceOutcome = "in_progress";
    }

    await entry.save();

    const populated = await TimeEntry.findById(entry._id)
      .populate("staffId", "name email role")
      .populate("scheduleId", "role startTime endTime status");

    res.json(populated);
  } catch (err) {
    next(err);
  }
};
