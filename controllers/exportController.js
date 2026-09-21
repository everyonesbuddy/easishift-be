const FacilityPreferences = require("../models/facilityPreferencesModel");
const Schedule = require("../models/scheduleModel");
const TimeEntry = require("../models/timeEntryModel");
const {
  formatProviderCsv,
  normalizeProvider,
} = require("../utils/payrollExportFormatters");

const MAX_EXPORT_RANGE_DAYS = 92;
const ACTUAL_EXPORT_STATUSES = ["completed", "adjusted"];
const SCHEDULED_EXPORT_STATUSES = [
  "scheduled",
  "in_progress",
  "completed",
  "left_early",
];

const parseDateRange = (query) => {
  if (!query.from || !query.to) {
    return { error: "from and to query parameters are required" };
  }

  const from = new Date(query.from);
  const to = new Date(query.to);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "from and to must be valid dates" };
  }

  if (from > to) {
    return { error: "from must be before to" };
  }

  const rangeDays = (to.getTime() - from.getTime()) / 86400000;
  if (rangeDays > MAX_EXPORT_RANGE_DAYS) {
    return { error: `Export range cannot exceed ${MAX_EXPORT_RANGE_DAYS} days` };
  }

  return { from, to };
};

const getTimeTrackingEnabled = async (tenantId) => {
  const prefs = await FacilityPreferences.findOne({ tenantId })
    .select("timeTracking.enabled")
    .lean();

  return Boolean(prefs?.timeTracking?.enabled);
};

const parseProvider = (provider) => {
  const normalized = normalizeProvider(provider);
  if (!normalized) {
    return {
      error: "provider must be one of: gusto, quickbooks, rippling",
    };
  }
  return { provider: normalized };
};

const buildFilename = ({ provider, source, from, to }) => {
  const fromLabel = from.toISOString().slice(0, 10);
  const toLabel = to.toISOString().slice(0, 10);
  return `wisershifts-${provider}-${source}-${fromLabel}-to-${toLabel}.csv`;
};

const sendCsv = (res, { csv, filename }) => {
  res.attachment(filename);
  res.type("text/csv");
  res.send(csv);
};

const loadActualTimeEntries = ({ tenantId, from, to }) =>
  TimeEntry.find({
    tenantId,
    status: { $in: ACTUAL_EXPORT_STATUSES },
    clockInAt: { $gte: from, $lte: to },
    clockOutAt: { $ne: null },
  })
    .sort({ clockInAt: 1 })
    .limit(5000)
    .populate("staffId", "name email role")
    .populate("scheduleId", "role unitArea startTime endTime status")
    .lean();

const loadScheduledShifts = ({ tenantId, from, to }) =>
  Schedule.find({
    tenantId,
    status: { $in: SCHEDULED_EXPORT_STATUSES },
    startTime: { $gte: from, $lte: to },
  })
    .sort({ startTime: 1 })
    .limit(5000)
    .populate("staffId", "name email role")
    .lean();

const exportRecords = async ({ req, res, next, provider, source }) => {
  try {
    const range = parseDateRange(req.query);
    if (range.error) {
      return res.status(400).json({ message: range.error });
    }

    const providerResult = parseProvider(provider);
    if (providerResult.error) {
      return res.status(400).json({ message: providerResult.error });
    }

    if (source === "actual") {
      const enabled = await getTimeTrackingEnabled(req.tenantId);
      if (!enabled) {
        return res.status(409).json({
          message:
            "Actual-hours export requires time tracking to be enabled for this facility",
        });
      }
    }

    const records =
      source === "actual"
        ? await loadActualTimeEntries({ tenantId: req.tenantId, ...range })
        : await loadScheduledShifts({ tenantId: req.tenantId, ...range });

    const csv = formatProviderCsv({
      provider: providerResult.provider,
      records,
      source,
    });

    return sendCsv(res, {
      csv,
      filename: buildFilename({
        provider: providerResult.provider,
        source,
        ...range,
      }),
    });
  } catch (err) {
    return next(err);
  }
};

exports.exportPayrollProvider = async (req, res, next) => {
  const source = String(req.query.source || "actual").toLowerCase();
  if (!["actual", "scheduled"].includes(source)) {
    return res.status(400).json({
      message: "source must be either actual or scheduled",
    });
  }

  return exportRecords({
    req,
    res,
    next,
    provider: req.params.provider,
    source,
  });
};

exports.exportTimeEntries = async (req, res, next) =>
  exportRecords({
    req,
    res,
    next,
    provider: req.query.provider,
    source: "actual",
  });

exports.exportSchedules = async (req, res, next) =>
  exportRecords({
    req,
    res,
    next,
    provider: req.query.provider,
    source: "scheduled",
  });