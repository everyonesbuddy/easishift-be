/**
 * Workweeks: the 7 days overtime is counted over.
 *
 * The building has one week (FacilityPreferences.weekStartsOn), which also
 * lays out and publishes the schedule. Some roles can count overtime over a
 * different week (FacilityPreferences.roleWeekStarts), e.g. dining (cooks,
 * servers) Thursday to Wednesday while nursing stays Sunday to Saturday.
 * The overtime law allows a different workweek for different groups of
 * employees. The schedule screen still shows one building-wide week; only
 * hours and overtime follow each person's own week.
 */
const { weekStartFor, weekBounds } = require("./dateUtils");

// "Med Tech", "med-tech" and "med_tech" are the same role.
const norm = (r) => String(r || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** The building's week settings, from FacilityPreferences (or getWeekSettings). */
function settingsFrom(prefs, timezone) {
  return {
    timezone: timezone || prefs?.facilityTimezone || "America/New_York",
    weekStartsOn: Number.isInteger(prefs?.weekStartsOn) ? prefs.weekStartsOn : 0,
    roleWeekStarts: cleanRoleWeekStarts(prefs?.roleWeekStarts),
  };
}

/** Groups that start on a valid day and have at least one role, roles lowercased, each role in one group only. */
function cleanRoleWeekStarts(groups) {
  const seen = new Set();
  const out = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    const day = Number(g?.weekStartsOn);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    const roles = [...new Set((g.roles || []).map(norm).filter(Boolean))].filter((r) => !seen.has(r));
    roles.forEach((r) => seen.add(r));
    if (roles.length) out.push({ roles, weekStartsOn: day });
  }
  return out;
}

const hasRoleWeeks = (ww) => Boolean(ww?.roleWeekStarts?.length);

/** Which day this person's workweek starts on: their role's group, or the building's. */
function weekdayFor(person, ww) {
  if (!hasRoleWeeks(ww) || !person) return ww?.weekStartsOn ?? 0;
  const roles = new Set([person.role, ...(person.roles || [])].map(norm).filter(Boolean));
  const group = ww.roleWeekStarts.find((g) => g.roles.some((r) => roles.has(r)));
  return group ? group.weekStartsOn : ww.weekStartsOn;
}

/** The start and end of this person's workweek containing `instant`. */
function weekRangeFor(person, instant, ww) {
  const key = weekStartFor(instant, ww.timezone, weekdayFor(person, ww));
  return { key, ...weekBounds(key, ww.timezone) };
}

/**
 * A staffId → weekday lookup for everyone in the workspace (one query, only
 * when some roles have their own week). Unknown ids get the building's day.
 */
async function weekdaysByStaff(tenantId, ww) {
  if (!hasRoleWeeks(ww)) return () => ww.weekStartsOn;
  const User = require("../models/userModel");
  const people = await User.find({ tenantId }).select("role roles").lean();
  const map = new Map(people.map((p) => [String(p._id), weekdayFor(p, ww)]));
  return (id) => (map.has(String(id)) ? map.get(String(id)) : ww.weekStartsOn);
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

module.exports = { settingsFrom, cleanRoleWeekStarts, hasRoleWeeks, weekdayFor, weekRangeFor, weekdaysByStaff, DAYS };
