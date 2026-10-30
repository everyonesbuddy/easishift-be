/**
 * HQ weeks: Monday to Sunday in the team's time zone (HQ_TIMEZONE, default
 * America/New_York). Week keys are the Monday's date, "2026-10-26".
 */
const { DateTime } = require("luxon");

const zone = () => process.env.HQ_TIMEZONE || "America/New_York";

const weekStartOf = (date = new Date()) => DateTime.fromJSDate(new Date(date), { zone: zone() }).startOf("week");
const weekKey = (date = new Date()) => weekStartOf(date).toISODate();

/** The last n weeks, oldest first: [{ key, start, end }] (end exclusive). */
function lastWeeks(n = 12, now = new Date()) {
  const thisWeek = weekStartOf(now);
  return Array.from({ length: n }, (_, i) => {
    const s = thisWeek.minus({ weeks: n - 1 - i });
    return { key: s.toISODate(), start: s.toJSDate(), end: s.plus({ weeks: 1 }).toJSDate() };
  });
}

/** Count dates into week buckets (pure). */
function bucket(weeks, dates) {
  const counts = Object.fromEntries(weeks.map((w) => [w.key, 0]));
  for (const d of dates) {
    if (!d) continue;
    const t = new Date(d).getTime();
    const w = weeks.find((x) => t >= x.start.getTime() && t < x.end.getTime());
    if (w) counts[w.key] += 1;
  }
  return counts;
}

module.exports = { zone, weekStartOf, weekKey, lastWeeks, bucket };
