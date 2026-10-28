/**
 * Labor: the leadership view of one building (owners, admins, schedulers
 * and viewers such as a DON). Dollar amounts and pay rates are for owners
 * and admins only (permission labor.costs).
 *
 * Routes: /api/v1/labor
 */
const mongoose = require("mongoose");
const { DateTime } = require("luxon");
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
  weekdayOfKey,
} = require("../utils/dateUtils");
const { countAssignmentsByCoverage } = require("../utils/scheduleUtils");
const { buildLaborReport } = require("../utils/laborReport");
const { eligibleStaffForCoverage, getCompatibleFacilityConfig } = require("../utils/eligibility");

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

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every date key in a "YYYY-MM" month. */
const monthDays = (month) => {
  const first = DateTime.fromISO(`${month}-01`, { zone: "UTC" });
  return Array.from({ length: first.daysInMonth }, (_, i) => first.plus({ days: i }).toISODate());
};

/** Week-start keys of every payroll week touching these days. */
const weeksCovering = (days, weekStartsOn) => {
  const keys = [];
  for (const d of days) {
    const diff = ((weekdayOfKey(d) - weekStartsOn) + 7) % 7;
    const key = addDaysToKey(d, -diff);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys;
};

/** Everything the report needs for a run of whole payroll weeks. */
async function loadLaborData({ tenantId, weekKeys, days, timezone }) {
  const from = weekBounds(weekKeys[0], timezone).start;
  const to = weekBounds(weekKeys[weekKeys.length - 1], timezone).end;
  // 8 weeks back from the end for the turnover watch.
  const lookback = new Date(Math.min(from.getTime(), to.getTime() - 56 * DAY_MS));
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
      .select("date role shiftType shiftTag startTime endTime requiredCount")
      .lean(),
    User.find({ tenantId, loginEnabled: false, status: "active" })
      .select("name roles certificationTags credentials status")
      .lean(),
  ]);
  const assigned = await countAssignmentsByCoverage({ tenantId, coverageIds: coverageRows.map((c) => c._id) });
  const coverage = coverageRows.map((c) => ({ ...c, assignedCount: assigned.get(String(c._id)) || 0 }));
  return { prefs, settings, schedules, timeEntries, coverage, staff };
}

/**
 * Loads everything for one week (weekStart) or one calendar month
 * (month: "YYYY-MM") and builds the report.
 */
async function loadLaborReport({ tenantId, weekStart, month, includeCosts, now = new Date() }) {
  const { timezone, weekStartsOn } = await getWeekSettings(tenantId);
  let days;
  let start;
  if (month) {
    if (!MONTH_RE.test(month)) {
      const err = new Error("month must be YYYY-MM");
      err.statusCode = 400;
      throw err;
    }
    days = monthDays(month);
    start = days[0];
  } else {
    start = weekStart || weekStartFor(now, timezone, weekStartsOn);
    assertWeekStart(start, weekStartsOn);
    days = weekDays(start);
  }
  const weekKeys = month ? weeksCovering(days, weekStartsOn) : [start];
  const data = await loadLaborData({ tenantId, weekKeys, days, timezone });

  return buildLaborReport({
    period: month ? "month" : "week",
    weekStart: start,
    days,
    weekStarts: weekKeys,
    timezone,
    thresholdHours: Number(data.prefs?.weeklyOvertimeThresholdHours) || 40,
    schedules: data.schedules,
    timeEntries: data.timeEntries,
    coverage: data.coverage,
    staff: data.staff,
    settings: data.settings,
    shiftLabel: shiftLabeler(data.prefs),
    includeCosts,
    now,
  });
}

/**
 * Week-by-week numbers for the trend lines, ending with `endWeek`. One load
 * for the whole range, then the same report math per week.
 */
async function loadLaborTrends({ tenantId, endWeek, weeks = 12, includeCosts, now = new Date() }) {
  const { timezone, weekStartsOn } = await getWeekSettings(tenantId);
  const last = endWeek || weekStartFor(now, timezone, weekStartsOn);
  assertWeekStart(last, weekStartsOn);
  const weekKeys = Array.from({ length: weeks }, (_, i) => addDaysToKey(last, (i - weeks + 1) * 7));
  const allDays = weekKeys.flatMap((k) => weekDays(k));
  const data = await loadLaborData({ tenantId, weekKeys, days: allDays, timezone });
  const thresholdHours = Number(data.prefs?.weeklyOvertimeThresholdHours) || 40;
  const thisWeek = weekStartFor(now, timezone, weekStartsOn);

  return weekKeys.map((key) => {
    const days = weekDays(key);
    const daySet = new Set(days);
    const r = buildLaborReport({
      weekStart: key,
      days,
      weekStarts: [key],
      timezone,
      thresholdHours,
      schedules: data.schedules,
      timeEntries: data.timeEntries,
      coverage: data.coverage.filter((c) => daySet.has(new Date(c.date).toISOString().slice(0, 10))),
      staff: data.staff,
      settings: data.settings,
      includeCosts,
      now,
    });
    return {
      weekStart: key,
      // This week and later aren't over yet.
      inProgress: key >= thisWeek,
      staffedHours: r.hours.scheduled,
      neededHours: r.hours.needed,
      ppd: r.budget?.scheduledPPD ?? null,
      targetPPD: r.budget?.targetPPD ?? null,
      overtimeHours: r.overtime.totalOvertimeHours,
      callOuts: r.attendance.callOuts,
      noShows: r.attendance.noShows,
      cost: r.costs?.scheduled ?? null,
    };
  });
}

const shiftMonth = (month, delta) =>
  DateTime.fromISO(`${month}-01`, { zone: "UTC" }).plus({ months: delta }).toFormat("yyyy-MM");

/**
 * GET /api/v1/labor/report?weekStart=YYYY-MM-DD (default: this week)
 * GET /api/v1/labor/report?month=YYYY-MM — a calendar month
 */
exports.getReport = async (req, res, next) => {
  try {
    const weekStart = req.query.weekStart ? String(req.query.weekStart) : null;
    const month = req.query.month ? String(req.query.month) : null;
    const { timezone, weekStartsOn } = await getWeekSettings(req.tenantId);
    const now = new Date();
    const thisWeek = weekStartFor(now, timezone, weekStartsOn);
    const thisMonth = DateTime.fromJSDate(now, { zone: timezone || "UTC" }).toFormat("yyyy-MM");
    const report = await loadLaborReport({
      tenantId: req.tenantId,
      weekStart: month ? null : weekStart || thisWeek,
      month,
      includeCosts: hasPermission(req.user, "labor.costs"),
      now,
    });
    res.json({
      ...report,
      thisWeek,
      thisMonth,
      ...(month
        ? { month, previous: shiftMonth(month, -1), next: shiftMonth(month, 1) }
        : { previous: addDaysToKey(report.weekStart, -7), next: addDaysToKey(report.weekStart, 7) }),
      canSeeCosts: hasPermission(req.user, "labor.costs"),
      canManage: hasPermission(req.user, "labor.manage"),
      canFixOvertime: hasPermission(req.user, "schedule.manage"),
      canEnterCensus: hasPermission(req.user, "labor.census"),
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message, errorCode: err.errorCode });
    next(err);
  }
};

/**
 * GET /api/v1/labor/trends?weeks=12&endWeek=YYYY-MM-DD — one point per
 * week (hours per resident day, overtime, call-outs, cost for owners/admins).
 */
exports.getTrends = async (req, res, next) => {
  try {
    const weeks = Math.min(26, Math.max(4, Number(req.query.weeks) || 12));
    const endWeek = req.query.endWeek ? String(req.query.endWeek) : null;
    const points = await loadLaborTrends({
      tenantId: req.tenantId,
      endWeek,
      weeks,
      includeCosts: hasPermission(req.user, "labor.costs"),
    });
    res.json({ weeks: points });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message, errorCode: err.errorCode });
    next(err);
  }
};

/**
 * GET /api/v1/labor/overtime/:staffId/options?weekStart=YYYY-MM-DD
 *
 * For someone heading into overtime: their shifts that week that haven't
 * started, and for each, who could take it without going into overtime
 * themselves (right role, area, shift and certifications; free; not on time
 * off). The website then reassigns with PUT /schedules/:id { staffId }.
 */
exports.getOvertimeOptions = async (req, res, next) => {
  try {
    const { staffId } = req.params;
    if (!mongoose.isValidObjectId(staffId)) return res.status(400).json({ message: "Invalid staffId" });
    const { timezone, weekStartsOn } = await getWeekSettings(req.tenantId);
    const now = new Date();
    const weekStart = req.query.weekStart ? String(req.query.weekStart) : weekStartFor(now, timezone, weekStartsOn);
    assertWeekStart(weekStart, weekStartsOn);
    const { start, end } = weekBounds(weekStart, timezone);

    const [prefs, person, staffList] = await Promise.all([
      FacilityPreferences.findOne({ tenantId: req.tenantId }).lean(),
      User.findOne({ _id: staffId, tenantId: req.tenantId, loginEnabled: false }).select("name").lean(),
      User.find({ tenantId: req.tenantId, loginEnabled: false, status: "active" })
        .select("tenantId name role roles allowedAreas allowedShiftTypes certificationTags phoneE164 email smsConsent")
        .lean(),
    ]);
    if (!person) return res.status(404).json({ message: "Staff not found" });
    const thresholdHours = Number(prefs?.weeklyOvertimeThresholdHours) || 40;

    const weekShifts = await Schedule.find({
      tenantId: req.tenantId,
      staffId,
      status: { $nin: ["call_out", "no_show"] },
      startTime: { $gte: start, $lt: end },
    })
      .select("coverageId role unitArea shiftType shiftTag certificationTags startTime endTime status state")
      .sort({ startTime: 1 })
      .lean();
    const hoursOf = (s) => (new Date(s.endTime) - new Date(s.startTime)) / 3600000;
    const weekHours = weekShifts.reduce((sum, s) => sum + hoursOf(s), 0);
    const overtimeHours = Math.max(0, weekHours - thresholdHours);

    const movable = weekShifts.filter((s) => new Date(s.startTime) > now && s.status === "scheduled");
    const coverageById = new Map(
      (await Coverage.find({ _id: { $in: movable.map((s) => s.coverageId).filter(Boolean) }, tenantId: req.tenantId }).lean())
        .map((c) => [String(c._id), c]),
    );
    const facilityConfig = getCompatibleFacilityConfig(prefs);
    const labelOf = shiftLabeler(prefs);

    const shifts = [];
    // Latest first: the end of the week is where the overtime is.
    for (const s of movable.slice().reverse()) {
      const cov = s.coverageId ? coverageById.get(String(s.coverageId)) : null;
      const target = cov || {
        _id: null,
        role: s.role,
        unitArea: s.unitArea,
        shiftType: s.shiftType,
        shiftTag: s.shiftTag,
        requiredCertificationTags: s.certificationTags || [],
        startTime: s.startTime,
        endTime: s.endTime,
      };
      const rows = await eligibleStaffForCoverage({
        tenantId: req.tenantId,
        coverage: { ...target, startTime: s.startTime, endTime: s.endTime },
        facilityConfig,
        weekStart: start,
        weekEnd: end,
        overtimeThresholdMinutes: thresholdHours * 60,
        excludeStaffIds: [staffId],
        staffList,
      });
      const h = hoursOf(s);
      shifts.push({
        scheduleId: s._id,
        startTime: s.startTime,
        endTime: s.endTime,
        role: s.role,
        unitArea: s.unitArea || null,
        label: s.shiftType ? labelOf(s.shiftType, s.shiftTag) : null,
        hours: Math.round(h * 10) / 10,
        published: s.state === "published",
        // Overtime saved by moving just this shift.
        saves: Math.round(Math.min(h, overtimeHours) * 10) / 10,
        candidates: rows
          .filter((r) => r.eligible && !r.overtimeIfAssigned)
          .slice(0, 5)
          .map((r) => ({
            staffId: r.staff._id,
            name: r.staff.name,
            weekHours: Math.round((r.weekMinutes / 60) * 10) / 10,
          })),
      });
    }
    res.json({
      staffId,
      name: person.name,
      weekStart,
      thresholdHours,
      weekHours: Math.round(weekHours * 10) / 10,
      overtimeHours: Math.round(overtimeHours * 10) / 10,
      shifts,
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
 * PUT /api/v1/labor/census — residents by day (owners, admins, schedulers).
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
exports.loadLaborTrends = loadLaborTrends;
