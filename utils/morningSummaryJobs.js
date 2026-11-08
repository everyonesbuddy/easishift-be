/**
 * Managers' morning summary (hourly; sends at 6 a.m. facility time).
 * For each workspace with something happening today: today's shifts, slots
 * still open, call-outs from the last 24 hours and who's covering, requests
 * waiting, and who's heading into overtime. A text to managers who opted in
 * (texting plans), otherwise an email. Once per workspace per day.
 */
const { DateTime } = require("luxon");
const Tenant = require("../models/tenantModel");
const Schedule = require("../models/scheduleModel");
const Coverage = require("../models/coverageModel");
const TimeOff = require("../models/timeOffModel");
const ShiftSwap = require("../models/shiftSwapModel");
const User = require("../models/userModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const ManagerDigest = require("../models/managerDigestModel");
const { getWeekSettings } = require("./weekService");
const { weekStartFor, weekBounds } = require("./dateUtils");
const { remainingFor } = require("./callouts");
const { buildMorningSummary } = require("./morningSummary");
const { alertManagers, appUrl } = require("./managerAlerts");

const SEND_HOUR = 6;
const WORKING = ["scheduled", "in_progress", "completed", "left_early"];

/** What happened and what's coming, for one workspace's day. */
async function factsFor(tenant, now = new Date()) {
  const tenantId = tenant._id;
  const { timezone, weekStartsOn } = await getWeekSettings(tenantId);
  const local = DateTime.fromJSDate(now, { zone: timezone });
  const dayStart = local.startOf("day").toJSDate();
  const dayEnd = local.endOf("day").toJSDate();
  const prefs = await FacilityPreferences.findOne({ tenantId }).select("weeklyOvertimeThresholdHours").lean();
  const otMinutes = (Number(prefs?.weeklyOvertimeThresholdHours) || 40) * 60;

  const [todays, coverages, calledOut, pendingTimeOff, pendingSwaps] = await Promise.all([
    Schedule.find({ tenantId, state: "published", startTime: { $gte: dayStart, $lte: dayEnd } }).select("status").lean(),
    Coverage.find({ tenantId, startTime: { $gte: dayStart, $lte: dayEnd } }).lean(),
    Schedule.find({ tenantId, status: "call_out", "meta.calledOutAt": { $gte: new Date(now.getTime() - 24 * 3600e3) }, endTime: { $gt: now } })
      .select("staffId role startTime coverageId meta.calledOutAt")
      .populate("staffId", "name")
      .lean(),
    TimeOff.countDocuments({ tenantId, status: "pending" }),
    ShiftSwap.countDocuments({ tenantId, status: "pending_admin" }),
  ]);

  const open = [];
  for (const c of coverages) {
    const left = await remainingFor(c);
    for (let i = 0; i < left; i += 1) open.push({ role: c.role, start: c.startTime });
  }
  open.sort((a, b) => new Date(a.start) - new Date(b.start));

  const callouts = [];
  for (const s of calledOut) {
    let coveredBy = null;
    if (s.coverageId) {
      const cover = await Schedule.findOne({ tenantId, coverageId: s.coverageId, status: { $in: WORKING }, _id: { $ne: s._id }, createdAt: { $gte: s.meta?.calledOutAt || new Date(0) } })
        .select("staffId")
        .populate("staffId", "name")
        .lean();
      coveredBy = cover?.staffId?.name ? String(cover.staffId.name).split(/\s+/)[0] : null;
    }
    callouts.push({ name: String(s.staffId?.name || "Someone").split(/\s+/)[0], role: s.role, start: s.startTime, coveredBy });
  }

  // This week's scheduled hours per person, at or over the overtime line.
  const { start, end } = weekBounds(weekStartFor(now, timezone, weekStartsOn), timezone);
  const week = await Schedule.find({ tenantId, state: "published", status: { $in: WORKING }, startTime: { $gte: start, $lt: end } }).select("staffId startTime endTime").lean();
  const minutes = new Map();
  for (const s of week) minutes.set(String(s.staffId), (minutes.get(String(s.staffId)) || 0) + (new Date(s.endTime) - new Date(s.startTime)) / 60000);
  const overIds = [...minutes].filter(([, m]) => m >= otMinutes).map(([id]) => id);
  const names = overIds.length ? new Map((await User.find({ _id: { $in: overIds } }).select("name").lean()).map((u) => [String(u._id), u.name])) : new Map();
  const overtime = overIds
    .map((id) => ({ name: String(names.get(id) || "Someone").split(/\s+/)[0], hours: Math.round((minutes.get(id) / 60) * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);

  return {
    facility: tenant.name || "Your facility",
    timezone,
    dayKey: local.toISODate(),
    localHour: local.hour,
    shiftsToday: todays.filter((s) => s.status !== "call_out").length,
    open,
    callouts,
    pendingTimeOff,
    pendingSwaps,
    overtime,
  };
}

/** Send to every workspace where it's 6 a.m. now and something is happening today. */
async function sendMorningSummaries(now = new Date()) {
  let sent = 0;
  const tenants = await Tenant.find({}).select("name").lean();
  for (const tenant of tenants) {
    try {
      const { timezone } = await getWeekSettings(tenant._id);
      const local = DateTime.fromJSDate(now, { zone: timezone });
      if (local.hour !== SEND_HOUR) continue;
      const facts = await factsFor(tenant, now);
      const quiet = !facts.shiftsToday && !facts.open.length && !facts.callouts.length && !facts.pendingTimeOff && !facts.pendingSwaps;
      if (quiet) continue;
      // Claim the day first so two servers never both send.
      try {
        await ManagerDigest.create({ tenantId: tenant._id, dayKey: facts.dayKey });
      } catch (e) {
        if (e?.code === 11000) continue;
        throw e;
      }
      const link = appUrl("/dashboard");
      const results = await alertManagers({
        tenantId: tenant._id,
        kind: "morning_summary",
        sms: (m) => buildMorningSummary(facts, m, link).sms,
        emailSubject: (m) => buildMorningSummary(facts, m, link).subject,
        emailHtml: (m) => buildMorningSummary(facts, m, link).html,
      });
      const n = results.filter((r) => r.delivered).length;
      sent += n;
      await ManagerDigest.updateOne({ tenantId: tenant._id, dayKey: facts.dayKey }, { $set: { sent: n } });
    } catch (err) {
      console.error(`morning summary failed for ${tenant._id}:`, err.message);
    }
  }
  return { sent };
}

module.exports = { sendMorningSummaries, factsFor, SEND_HOUR };
