const mongoose = require("mongoose");
const crypto = require("crypto");

const FacilityPreferences = require("../models/facilityPreferencesModel");
const Schedule = require("../models/scheduleModel");
const TimeEntry = require("../models/timeEntryModel");

const DEFAULT_TIME_TRACKING = {
  enabled: false,
  mode: "open",
  requireScheduleMatch: true,
  clockInGraceMinutes: 15,
  clockOutGraceMinutes: 30,
  roundingMinutes: 0,
  autoCloseOpenBreakOnClockOut: true,
};

const generateQrTokenValue = () => crypto.randomBytes(24).toString("hex");

const hashQrToken = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

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
    mode: ["open", "qr"].includes(configured.mode)
      ? configured.mode
      : DEFAULT_TIME_TRACKING.mode,
    requireScheduleMatch:
      configured.requireScheduleMatch !== undefined
        ? Boolean(configured.requireScheduleMatch)
        : DEFAULT_TIME_TRACKING.requireScheduleMatch,
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
    autoCloseOpenBreakOnClockOut:
      configured.autoCloseOpenBreakOnClockOut !== undefined
        ? Boolean(configured.autoCloseOpenBreakOnClockOut)
        : DEFAULT_TIME_TRACKING.autoCloseOpenBreakOnClockOut,
    qrTokenHash: configured.qrTokenHash || null,
    qrTokenVersion: configured.qrTokenVersion ?? 0,
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

const verifyQrToken = (token, config) => {
  if (!token || typeof token !== "string") {
    return { ok: false, message: "qrToken is required" };
  }

  if (!config?.qrTokenHash) {
    return {
      ok: false,
      message: "QR token is not configured for this facility",
    };
  }

  const providedHash = hashQrToken(token);
  if (providedHash !== config.qrTokenHash) {
    return { ok: false, message: "Invalid QR token" };
  }

  return { ok: true, payload: { tokenVersion: config.qrTokenVersion ?? 0 } };
};

const requireQrTokenWhenNeeded = (config, qrToken, res) => {
  if (config.mode !== "qr") return null;

  if (!qrToken) {
    res.status(400).json({
      message: "qrToken is required while time tracking mode is 'qr'",
    });
    return false;
  }

  const verified = verifyQrToken(qrToken, config);
  if (!verified.ok) {
    res.status(400).json({ message: verified.message });
    return false;
  }

  return verified.payload;
};

const rotateFacilityQrToken = async (tenantId) => {
  const token = generateQrTokenValue();
  const tokenHash = hashQrToken(token);

  const currentPrefs = await FacilityPreferences.findOne({ tenantId }).lean();
  const nextVersion = (currentPrefs?.timeTracking?.qrTokenVersion ?? 0) + 1;

  await FacilityPreferences.updateOne(
    { tenantId },
    {
      $set: {
        "timeTracking.qrTokenHash": tokenHash,
        "timeTracking.qrTokenValue": token,
        "timeTracking.qrTokenVersion": nextVersion,
      },
    },
    { upsert: true },
  );

  return { token, version: nextVersion };
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

    const qrPayload = requireQrTokenWhenNeeded(config, req.body.qrToken, res);
    if (qrPayload === false) return;

    let schedule = null;
    if (config.requireScheduleMatch) {
      schedule = await findScheduleForClockAction({
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
    }

    const created = await TimeEntry.create({
      tenantId: req.tenantId,
      staffId: req.user._id,
      scheduleId: schedule ? schedule._id : null,
      clockInAt,
      mode: config.mode,
      source: ["mobile", "web", "admin"].includes(req.body.source)
        ? req.body.source
        : "mobile",
      notes: req.body.note || "",
      qrScan:
        config.mode === "qr"
          ? {
              tokenId: qrPayload?.tokenId || null,
              scannedAt: new Date(),
            }
          : undefined,
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

    let response = populated;
    if (config.mode === "qr") {
      const rotation = await rotateFacilityQrToken(req.tenantId);
      response = populated.toObject ? populated.toObject() : populated;
      response.nextQrToken = rotation.token;
      response.nextQrTokenVersion = rotation.version;
    }

    res.status(201).json(response);
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

    const qrPayload = requireQrTokenWhenNeeded(config, req.body.qrToken, res);
    if (qrPayload === false) return;

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
    entry.status = "completed";
    if (req.body.note) {
      entry.notes = entry.notes
        ? `${entry.notes}\n${req.body.note}`
        : req.body.note;
    }

    entry.totals = computeTotals(entry, config.roundingMinutes);

    if (config.mode === "qr") {
      entry.qrScan = {
        tokenId: qrPayload?.tokenId || entry.qrScan?.tokenId || null,
        scannedAt: new Date(),
      };
    }

    if (entry.scheduleId) {
      const schedule = await Schedule.findOne({
        _id: entry.scheduleId,
        tenantId: req.tenantId,
      }).select("endTime");

      const scheduledEndTime = schedule ? new Date(schedule.endTime) : null;
      const earlyCheckoutCutoff = scheduledEndTime
        ? new Date(
            scheduledEndTime.getTime() -
              config.clockOutGraceMinutes * 60 * 1000,
          )
        : null;
      const leftEarly = earlyCheckoutCutoff
        ? clockOutAt < earlyCheckoutCutoff
        : false;

      await Schedule.findOneAndUpdate(
        {
          _id: entry.scheduleId,
          tenantId: req.tenantId,
          status: { $ne: "call_out" },
        },
        {
          $set: {
            status: leftEarly ? "left_early" : "completed",
            ...(leftEarly
              ? { "meta.leftEarlyAt": clockOutAt }
              : { "meta.completedAt": clockOutAt }),
          },
        },
      );
    }

    await entry.save();

    const populated = await TimeEntry.findById(entry._id).populate(
      "scheduleId",
      "role startTime endTime status",
    );

    let response = populated;
    if (config.mode === "qr") {
      const rotation = await rotateFacilityQrToken(req.tenantId);
      response = populated.toObject ? populated.toObject() : populated;
      response.nextQrToken = rotation.token;
      response.nextQrTokenVersion = rotation.version;
    }

    res.json(response);
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

    await entry.save();

    const populated = await TimeEntry.findById(entry._id)
      .populate("staffId", "name email role")
      .populate("scheduleId", "role startTime endTime status");

    let response = populated;
    if (config.mode === "qr") {
      const rotation = await rotateFacilityQrToken(req.tenantId);
      response = populated.toObject ? populated.toObject() : populated;
      response.nextQrToken = rotation.token;
      response.nextQrTokenVersion = rotation.version;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
};

exports.getCurrentQrClockToken = async (req, res, next) => {
  try {
    const config = await getTimeTrackingConfig(req.tenantId);
    if (!ensureTrackingEnabled(config, res)) return;

    if (config.mode !== "qr") {
      return res.status(409).json({
        message: "Facility time tracking mode is not set to 'qr'",
      });
    }

    const prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId })
      .select("timeTracking.qrTokenValue timeTracking.qrTokenVersion")
      .lean();

    if (!prefs?.timeTracking?.qrTokenValue) {
      const rotation = await rotateFacilityQrToken(req.tenantId);
      return res.json({
        token: rotation.token,
        tokenVersion: rotation.version,
      });
    }

    res.json({
      token: prefs.timeTracking.qrTokenValue,
      tokenVersion: prefs.timeTracking.qrTokenVersion ?? 0,
    });
  } catch (err) {
    next(err);
  }
};

exports.generateQrClockToken = async (req, res, next) => {
  try {
    const config = await getTimeTrackingConfig(req.tenantId);
    if (!ensureTrackingEnabled(config, res)) return;

    if (config.mode !== "qr") {
      return res.status(409).json({
        message: "Facility time tracking mode is not set to 'qr'",
      });
    }

    const rotation = await rotateFacilityQrToken(req.tenantId);

    res.status(201).json({
      token: rotation.token,
      tokenVersion: rotation.version,
    });
  } catch (err) {
    next(err);
  }
};

exports.hashQrToken = hashQrToken;
exports.generateQrTokenValue = generateQrTokenValue;
