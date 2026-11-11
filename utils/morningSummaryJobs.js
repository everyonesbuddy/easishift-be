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
const { weekStartFor, weekBounds, dateKeyToCoverageDate } = require("./dateUtils");
const workweek = require("./workweek");
const ScheduleWeek = require("../models/scheduleWeekModel");
const { findSchedulers } = require("./schedulers");
const { nextStep, buildNudge } = require("./setupNudge");
const { getEffectivePlanKey, hasFeature } = require("../config/plans");
const { remainingFor } = require("./callouts");
const { buildMorningSummary } = require("./morningSummary");
const { alertManagers, appUrl } = require("./managerAlerts");

const SEND_HOUR = 6; // the morning summary
const NUDGE_HOUR = 10; // a next-step nudge on its own, on quiet days
const NUDGE_DAYS = new Set([1, 3, 5]); // Monday, Wednesday, Friday
const WORKING = ["scheduled", "in_progress", "completed", "left_early"];

/** What happened and what's coming, for one workspace's day. */
async function factsFor(tenant, now = new Date()) {
  const tenantId = tenant._id;
  const { timezone, weekStartsOn, roleWeekStarts } = await getWeekSettings(tenantId);
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
  // Each person's own workweek when some roles have one (utils/workweek.js).
  const ww = { timezone, weekStartsOn, roleWeekStarts };
  const roleWeeks = workweek.hasRoleWeeks(ww);
  const { start, end } = weekBounds(weekStartFor(now, timezone, weekStartsOn), timezone);
  const margin = roleWeeks ? 7 * 86400000 : 0;
  const week = await Schedule.find({ tenantId, state: "published", status: { $in: WORKING }, startTime: { $gte: new Date(start.getTime() - margin), $lt: new Date(end.getTime() + margin) } })
    .select("staffId startTime endTime")
    .lean();
  const weekdayOf = roleWeeks ? await workweek.weekdaysByStaff(tenantId, ww) : null;
  const ownWeek = new Map(); // staffId → { start, end }
  const inOwnWeek = (s) => {
    if (!weekdayOf) return true;
    const id = String(s.staffId);
    if (!ownWeek.has(id)) ownWeek.set(id, weekBounds(weekStartFor(now, timezone, weekdayOf(id)), timezone));
    const w = ownWeek.get(id);
    return new Date(s.startTime) >= w.start && new Date(s.startTime) < w.end;
  };
  const minutes = new Map();
  for (const s of week) {
    if (!inOwnWeek(s)) continue;
    minutes.set(String(s.staffId), (minutes.get(String(s.staffId)) || 0) + (new Date(s.endTime) - new Date(s.startTime)) / 60000);
  }
  const overIds = [...minutes].filter(([, m]) => m >= otMinutes).map(([id]) => id);
  const names = overIds.length ? new Map((await User.find({ _id: { $in: overIds } }).select("name").lean()).map((u) => [String(u._id), u.name])) : new Map();
  const overtime = overIds
    .map((id) => ({ name: String(names.get(id) || "Someone").split(/\s+/)[0], hours: Math.round((minutes.get(id) / 60) * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);

  // Where they are in getting started, for the next step.
  const thisKey = weekStartFor(now, timezone, weekStartsOn);
  const nextKey = DateTime.fromISO(thisKey, { zone: timezone }).plus({ weeks: 1 }).toISODate();
  const [managers, people, weeks] = await Promise.all([
    findSchedulers(tenantId).select("_id").lean(),
    User.find({ tenantId, status: { $ne: "archived" } }).select("phoneE164 smsConsent").lean(),
    ScheduleWeek.find({ tenantId, weekStart: { $in: [dateKeyToCoverageDate(thisKey), dateKeyToCoverageDate(nextKey)] }, status: "published" }).select("weekStart").lean(),
  ]);
  const mgr = new Set(managers.map((m) => String(m._id)));
  const staff = people.filter((u) => !mgr.has(String(u._id)));
  const published = new Set(weeks.map((w) => new Date(w.weekStart).toISOString().slice(0, 10)));
  const setup = {
    createdAt: tenant.createdAt,
    setupDone: Boolean(tenant.setupCompletedAt),
    staff: staff.length,
    staffWithPhone: staff.filter((u) => u.phoneE164).length,
    optedIn: staff.filter((u) => u.phoneE164 && u.smsConsent?.status === "opted_in").length,
    smsPlan: hasFeature(getEffectivePlanKey(tenant), "sms"),
    thisWeekPublished: published.has(thisKey),
    nextWeekPublished: published.has(nextKey),
    weekday: local.weekday,
  };

  return {
    facility: tenant.name || "Your facility",
    setup,
    step: nextStep(setup, appUrl, now),
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

const isQuiet = (f) => !f.shiftsToday && !f.open.length && !f.callouts.length && !f.pendingTimeOff && !f.pendingSwaps;

/** Claim a workspace's day for one kind of message, so it goes out once even with two servers. */
async function claim(tenantId, dayKey) {
  try {
    await ManagerDigest.create({ tenantId, dayKey });
    return true;
  } catch (e) {
    if (e?.code === 11000) return false;
    throw e;
  }
}

/**
 * Send one workspace's message now. which: "summary" (the morning summary,
 * with the next step in it), "nudge" (the next step on its own). force skips
 * the time and once-a-day checks (HQ's test button).
 */
async function runFor(tenant, which, { now = new Date(), force = false } = {}) {
  const facts = await factsFor(tenant, now);
  if (which === "summary") {
    if (!force && isQuiet(facts)) return { sent: 0, skipped: "quiet" };
    if (!force && !(await claim(tenant._id, facts.dayKey))) return { sent: 0, skipped: "already_sent" };
    const link = appUrl("/dashboard");
    const results = await alertManagers({
      tenantId: tenant._id,
      kind: "morning_summary",
      // Texted only when something needs them (an open slot, an uncovered call-out, a request…); otherwise email.
      sms: (m) => {
        const b = buildMorningSummary(facts, m, link);
        return b.needsYou || force ? b.sms : null; // HQ's test button always texts, so you can see it
      },
      emailSubject: (m) => buildMorningSummary(facts, m, link).subject,
      emailHtml: (m) => buildMorningSummary(facts, m, link).html,
    });
    return { sent: results.filter((r) => r.delivered).length, results, facts };
  }
  if (which === "nudge") {
    if (!facts.step) return { sent: 0, skipped: "nothing_to_nudge", facts };
    if (!force && !(await claim(tenant._id, `${facts.dayKey}:nudge`))) return { sent: 0, skipped: "already_sent" };
    const results = await alertManagers({
      tenantId: tenant._id,
      kind: "morning_summary", // same off switch as the summary
      // Nudges go by email, except "publish next week" on Friday, which is time-sensitive.
      sms: (m) => (facts.step.key === "publish_next" || force ? buildNudge(facts.step, facts.facility, m).sms : null),
      emailSubject: (m) => buildNudge(facts.step, facts.facility, m).subject,
      emailHtml: (m) => buildNudge(facts.step, facts.facility, m).html,
    });
    return { sent: results.filter((r) => r.delivered).length, results, facts };
  }
  throw new Error(`Unknown message: ${which}`);
}

/**
 * Hourly. At 6 a.m. facility time: the morning summary wherever something is
 * happening today. At 10 a.m. on Mondays, Wednesdays and Fridays: the next
 * step on its own wherever the day is quiet and something's left to do
 * (signed up but never set up, no staff, nothing published…).
 */
async function sendMorningSummaries(now = new Date()) {
  let sent = 0;
  const tenants = await Tenant.find({}).select("name createdAt setupCompletedAt plan subscriptionStatus trialEndsAt").lean();
  for (const tenant of tenants) {
    try {
      const { timezone } = await getWeekSettings(tenant._id);
      const local = DateTime.fromJSDate(now, { zone: timezone });
      if (local.hour === SEND_HOUR) sent += (await runFor(tenant, "summary", { now })).sent;
      else if (local.hour === NUDGE_HOUR && NUDGE_DAYS.has(local.weekday)) {
        const facts = await factsFor(tenant, now);
        if (isQuiet(facts) && facts.step) sent += (await runFor(tenant, "nudge", { now })).sent;
      }
    } catch (err) {
      console.error(`morning summary failed for ${tenant._id}:`, err.message);
    }
  }
  return { sent };
}

module.exports = { sendMorningSummaries, runFor, factsFor, SEND_HOUR, NUDGE_HOUR };
