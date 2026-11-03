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

/**
 * A date picked in a form. "2026-11-02" means that day in the team's time
 * zone: now if it's today, otherwise noon. (Read as UTC midnight it would be
 * the evening before here, and a Monday post would count for last week.)
 */
function dayToDate(v, now = new Date()) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const today = DateTime.fromJSDate(new Date(now), { zone: zone() }).toISODate();
    return v === today ? new Date(now) : DateTime.fromISO(v, { zone: zone() }).set({ hour: 12 }).toJSDate();
  }
  return new Date(v);
}

module.exports = { zone, weekStartOf, weekKey, lastWeeks, bucket, dayToDate };
