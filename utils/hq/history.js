/**
 * HQ history: what got done in a past period (last week, last month…), as
 * pure functions. Periods are in the team's time zone, Monday-start weeks.
 */
const { DateTime } = require("luxon");
const { zone } = require("./weeks");

const RANGES = {
  this_week: "This week",
  last_week: "Last week",
  last_4_weeks: "Last 4 weeks",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom",
};

/** A named period → { key, label, start, end } (end exclusive). custom takes from/to as "2026-10-01". */
function rangeFor(key, { from, to, now = new Date() } = {}) {
  const z = zone();
  const today = DateTime.fromJSDate(new Date(now), { zone: z });
  const week = today.startOf("week");
  const month = today.startOf("month");
  let s;
  let e;
  if (key === "last_week") [s, e] = [week.minus({ weeks: 1 }), week];
  else if (key === "last_4_weeks") [s, e] = [week.minus({ weeks: 3 }), week.plus({ weeks: 1 })];
  else if (key === "this_month") [s, e] = [month, month.plus({ months: 1 })];
  else if (key === "last_month") [s, e] = [month.minus({ months: 1 }), month];
  else if (key === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(from || "") && /^\d{4}-\d{2}-\d{2}$/.test(to || "")) {
    s = DateTime.fromISO(from, { zone: z }).startOf("day");
    e = DateTime.fromISO(to, { zone: z }).startOf("day").plus({ days: 1 });
    if (e <= s) [s, e] = [e.minus({ days: 1 }), s.plus({ days: 1 })];
  } else {
    key = "this_week";
    [s, e] = [week, week.plus({ weeks: 1 })];
  }
  const fmt = (d) => d.toFormat("LLL d");
  const label = key === "custom" ? `${fmt(s)} to ${fmt(e.minus({ days: 1 }))}` : RANGES[key];
  return { key, label, start: s.toJSDate(), end: e.toJSDate(), days: Math.round(e.diff(s, "days").days), span: `${fmt(s)} to ${fmt(e.minus({ days: 1 }))}, ${e.minus({ days: 1 }).year}` };
}

/** A play's target over a period: its weekly target times the weeks in it (a month is about 4.3). */
function targetFor(play, days) {
  const t = Number(play.weeklyTarget) || 0;
  if (!t) return 0;
  return Math.max(1, Math.round((t * days) / 7));
}

/** How many of each outcome, e.g. { "Talked": 4, "Left a voicemail": 9 }, most first. */
function tally(labels) {
  const out = {};
  for (const l of labels) if (l) out[l] = (out[l] || 0) + 1;
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}

module.exports = { RANGES, rangeFor, targetFor, tally };
