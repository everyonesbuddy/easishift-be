/**
 * Labor: the leadership view of one building (owners, admins, schedulers
 * and viewers such as a DON). Dollar amounts and pay rates are for owners
 * and admins only (permission labor.costs).
 *
 * Routes: /api/v1/labor
 */
const mongoose = require("mongoose");
const Schedule = require("../models/scheduleModel");
const TimeEntry = require("../models/timeEntryModel");
const Coverage = require("../models/coverageModel");
const User = require("../models/userModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const LaborSettings = require("../models/laborSettingsModel");
const { hasPermission } = require("../config/authorization");
const { getWeekSettings, assertWeekStart } = require("../utils/weekService");
const {
  weekStartFor,
  weekDays,
  weekBounds,
  addDaysToKey,
  dateKeyToCoverageDate,
} = require("../utils/dateUtils");
const { countAssignmentsByCoverage } = require("../utils/scheduleUtils");
const { buildLaborReport } = require("../utils/laborReport");

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CENSUS_DAYS = 400;
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** "Day 7a–3p" style labels for shift slots, from Facility Preferences. */
const shiftLabeler = (prefs) => {
  const labels = new Map();
  for (const def of prefs?.shiftTypeDefinitions || []) {
    for (const slot of def.timeSlots || []) {
      labels.set(`${String(def.key).toLowerCase()}:${String(slot.tag).toLowerCase()}`, slot.label || def.label || def.key);
    }
  }
  return (type, tag) =>
    labels.get(`${String(type || "").toLowerCase()}:${String(tag || "").toLowerCase()}`) || [type, tag].filter(Boolean).join(" ");
};

/** Loads everything for one week and builds the report. */
async function loadLaborReport({ tenantId, weekStart, includeCosts, now = new Date() }) {
  const { timezone, weekStartsOn } = await getWeekSettings(tenantId);
  const start = weekStart || weekStartFor(now, timezone, weekStartsOn);
  assertWeekStart(start, weekStartsOn);
  const days = weekDays(start);
  const { start: from, end: to } = weekBounds(start, timezone);
  // 8 weeks back for the turnover watch.
  const lookback = new Date(to.getTime() - 56 * 24 * 60 * 60 * 1000);

  const [prefs, settings, schedules, timeEntries, coverageRows, staff] = await Promise.all([
    FacilityPreferences.findOne({ tenantId }).select("shiftTypeDefinitions weeklyOvertimeThresholdHours").lean(),
    LaborSettings.findOne({ tenantId }).lean(),
    Schedule.find({ tenantId, startTime: { $gte: lookback, $lt: to } })
      .select("staffId role unitArea shiftType shiftTag startTime endTime status")
      .lean(),
    TimeEntry.find({ tenantId, clockInAt: { $gte: from, $lt: to } })
      .select("staffId scheduleId clockInAt clockOutAt totals")
      .lean(),
    Coverage.find({ tenantId, date: { $in: days.map(dateKeyToCoverageDate) } })
      .select("role shiftType shiftTag startTime endTime requiredCount")
      .lean(),
    User.find({ tenantId, loginEnabled: false, status: "active" })
      .select("name roles certificationTags credentials status")
      .lean(),
  ]);
  const assigned = await countAssignmentsByCoverage({ tenantId, coverageIds: coverageRows.map((c) => c._id) });
  const coverage = coverageRows.map((c) => ({ ...c, assignedCount: assigned.get(String(c._id)) || 0 }));

  return buildLaborReport({
    weekStart: start,
    days,
    timezone,
    thresholdHours: Number(prefs?.weeklyOvertimeThresholdHours) || 40,
    schedules,
    timeEntries,
    coverage,
    staff,
    settings,
    shiftLabel: shiftLabeler(prefs),
    includeCosts,
    now,
  });
}

/**
 * GET /api/v1/labor/report?weekStart=YYYY-MM-DD (default: this week)
 */
exports.getReport = async (req, res, next) => {
  try {
    const weekStart = req.query.weekStart ? String(req.query.weekStart) : null;
    const { timezone, weekStartsOn } = await getWeekSettings(req.tenantId);
    const thisWeek = weekStartFor(new Date(), timezone, weekStartsOn);
    const report = await loadLaborReport({
      tenantId: req.tenantId,
      weekStart: weekStart || thisWeek,
      includeCosts: hasPermission(req.user, "labor.costs"),
    });
    res.json({
      ...report,
      thisWeek,
      previous: addDaysToKey(report.weekStart, -7),
      next: addDaysToKey(report.weekStart, 7),
      canSeeCosts: hasPermission(req.user, "labor.costs"),
      canManage: hasPermission(req.user, "labor.manage"),
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message, errorCode: err.errorCode });
    next(err);
  }
};

const toSettingsResponse = (doc, { withRates }) => ({
  budgetHoursPerResidentDay: doc?.budgetHoursPerResidentDay ?? null,
  typicalCensus: doc?.typicalCensus ?? null,
  census: (doc?.census || []).slice().sort((a, b) => a.date.localeCompare(b.date)),
  mondayReport: {
    enabled: doc?.mondayReport?.enabled !== false,
    extraRecipients: doc?.mondayReport?.extraRecipients || [],
    lastSentWeek: doc?.mondayReport?.lastSentWeek || null,
  },
  ...(withRates
    ? {
        payRates: doc?.payRates || [],
        staffRates: (doc?.staffRates || []).map((r) => ({ staffId: r.staffId, hourlyRate: r.hourlyRate })),
        overtimeMultiplier: doc?.overtimeMultiplier ?? 1.5,
      }
    : {}),
});

/**
 * GET /api/v1/labor/settings — budget, residents, Monday email; pay rates
 * only for owners/admins.
 */
exports.getSettings = async (req, res, next) => {
  try {
    const doc = await LaborSettings.findOne({ tenantId: req.tenantId }).lean();
    res.json(toSettingsResponse(doc, { withRates: hasPermission(req.user, "labor.costs") }));
  } catch (err) {
    next(err);
  }
};

const rateOf = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 500 ? Math.round(n * 100) / 100 : null;
};

/**
 * PUT /api/v1/labor/settings (owners/admins). Send only what changes:
 * { payRates: [{ role, hourlyRate }], staffRates: [{ staffId, hourlyRate }],
 *   overtimeMultiplier, budgetHoursPerResidentDay, typicalCensus,
 *   mondayReport: { enabled, extraRecipients: [email] } }
 */
exports.updateSettings = async (req, res, next) => {
  try {
    const body = req.body || {};
    const set = {};
    if (body.payRates !== undefined) {
      if (!Array.isArray(body.payRates)) return res.status(400).json({ message: "payRates must be a list" });
      const byRole = new Map();
      for (const r of body.payRates) {
        const role = String(r?.role || "").trim().toLowerCase();
        if (!role) continue;
        if (r.hourlyRate === null || r.hourlyRate === "") continue;
        const rate = rateOf(r.hourlyRate);
        if (rate === null) return res.status(400).json({ message: `Hourly rate for '${role}' must be 0–500` });
        byRole.set(role, { role, hourlyRate: rate });
      }
      set.payRates = [...byRole.values()];
    }
    if (body.staffRates !== undefined) {
      if (!Array.isArray(body.staffRates)) return res.status(400).json({ message: "staffRates must be a list" });
      const ids = body.staffRates.map((r) => r?.staffId).filter((id) => mongoose.isValidObjectId(id));
      const known = new Set(
        (await User.find({ _id: { $in: ids }, tenantId: req.tenantId, loginEnabled: false }).select("_id").lean())
          .map((u) => String(u._id)),
      );
      const byId = new Map();
      for (const r of body.staffRates) {
        const id = String(r?.staffId || "");
        if (!known.has(id) || r.hourlyRate === null || r.hourlyRate === "") continue;
        const rate = rateOf(r.hourlyRate);
        if (rate === null) return res.status(400).json({ message: "Hourly rates must be 0–500" });
        byId.set(id, { staffId: id, hourlyRate: rate });
      }
      set.staffRates = [...byId.values()];
    }
    if (body.overtimeMultiplier !== undefined) {
      const m = Number(body.overtimeMultiplier);
      if (!Number.isFinite(m) || m < 1 || m > 3) return res.status(400).json({ message: "Overtime multiplier must be 1–3" });
      set.overtimeMultiplier = m;
    }
    for (const [key, max] of [["budgetHoursPerResidentDay", 24], ["typicalCensus", 5000]]) {
      if (body[key] === undefined) continue;
      if (body[key] === null || body[key] === "") { set[key] = null; continue; }
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n < 0 || n > max) return res.status(400).json({ message: `${key} must be 0–${max}` });
      set[key] = Math.round(n * 100) / 100;
    }
    if (body.mondayReport !== undefined) {
      const mr = body.mondayReport || {};
      if (mr.enabled !== undefined) set["mondayReport.enabled"] = Boolean(mr.enabled);
      if (mr.extraRecipients !== undefined) {
        const list = [...new Set((Array.isArray(mr.extraRecipients) ? mr.extraRecipients : [])
          .map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
        const bad = list.find((e) => !isEmail(e));
        if (bad) return res.status(400).json({ message: `Invalid email '${bad}'` });
        if (list.length > 10) return res.status(400).json({ message: "Up to 10 extra people" });
        set["mondayReport.extraRecipients"] = list;
      }
    }
    set.updatedBy = req.user?._id || null;
    const doc = await LaborSettings.findOneAndUpdate(
      { tenantId: req.tenantId },
      { $set: set, $setOnInsert: { tenantId: req.tenantId } },
      { upsert: true, new: true, runValidators: true },
    ).lean();
    res.json(toSettingsResponse(doc, { withRates: true }));
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/v1/labor/census — residents by day (owners/admins).
 * Body: { entries: [{ date: "YYYY-MM-DD", residents: 42 | null }] }
 * null removes that day (it falls back to the usual number).
 */
exports.updateCensus = async (req, res, next) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
    if (!entries || !entries.length || entries.length > 62) {
      return res.status(400).json({ message: "entries must be a list of 1–62 days" });
    }
    const doc = (await LaborSettings.findOne({ tenantId: req.tenantId })) ||
      new LaborSettings({ tenantId: req.tenantId });
    const byDate = new Map((doc.census || []).map((c) => [c.date, c.residents]));
    for (const e of entries) {
      const date = String(e?.date || "");
      if (!KEY_RE.test(date)) return res.status(400).json({ message: `Invalid date '${date}'` });
      if (e.residents === null || e.residents === "") { byDate.delete(date); continue; }
      const n = Number(e.residents);
      if (!Number.isInteger(n) || n < 0 || n > 5000) return res.status(400).json({ message: "Residents must be a whole number 0–5000" });
      byDate.set(date, n);
    }
    doc.census = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-MAX_CENSUS_DAYS)
      .map(([date, residents]) => ({ date, residents }));
    doc.updatedBy = req.user?._id || null;
    await doc.save();
    res.json(toSettingsResponse(doc.toObject(), { withRates: hasPermission(req.user, "labor.costs") }));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/labor/report/send — email the Monday report now (to the
 * usual recipients), e.g. to try it. Owners/admins.
 */
exports.sendReportNow = async (req, res, next) => {
  try {
    // Required lazily so the cron module isn't loaded in every test.
    const { sendLaborReportForTenant } = require("../utils/laborReportJobs");
    const result = await sendLaborReportForTenant(req.tenant || { _id: req.tenantId }, { force: true });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.loadLaborReport = loadLaborReport;
