/**
 * Labor report for one week of one building (pure: no database).
 *
 * Feeds the Labor page and the Monday labor email. Everything comes from
 * the schedule, the time clock, open spots and staff credentials, plus
 * LaborSettings (pay rates, budget, residents):
 *
 * - hours: scheduled (shifts not called out / no-show) and worked (time
 *   clock), by role and by day
 * - budget: hours per resident day (PPD) against the target, when the
 *   number of residents is known
 * - costs: scheduled and worked labor cost incl. overtime premium (only
 *   when asked for, i.e. for owners/admins, and when rates are set)
 * - overtime: who will go over the weekly limit and on which day, before
 *   payroll ("Maria hits 52 hours Friday")
 * - attendance: call-outs and no-shows by shift, role and day
 * - open shifts: spots filled, missed (ended unfilled) and still open
 * - credentials: expired and expiring in the next 30 days (as of now)
 * - turnover watch: people showing signs of burning out or drifting away
 *   over the last 4 weeks (call-outs, no-shows, repeated overtime, hours
 *   falling off)
 */
const { DateTime } = require("luxon");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOT_WORKED = new Set(["call_out", "no_show"]);
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const idOf = (v) => String(v?._id || v || "");

const dayKeyIn = (instant, zone) =>
  DateTime.fromJSDate(new Date(instant), { zone }).toISODate();

const shiftHours = (s) => Math.max(0, (new Date(s.endTime) - new Date(s.startTime)) / HOUR);

/** Worked hours on a time entry (clocked out, or still in progress at `now`). */
const entryHours = (e, now) => {
  if (Number.isFinite(e?.totals?.workedMinutes) && e.clockOutAt) return e.totals.workedMinutes / 60;
  const end = e.clockOutAt ? new Date(e.clockOutAt) : now;
  return Math.max(0, (end - new Date(e.clockInAt)) / HOUR);
};

/**
 * `days` is the period: 7 days for a week, or every day of a month. Overtime
 * is always counted per payroll week (`weekStarts`, the weeks overlapping the
 * period; `schedules` and `timeEntries` must cover those whole weeks), and
 * each overtime hour belongs to the day it's worked, so a month only counts
 * the overtime that falls inside it.
 */
function buildLaborReport({
  weekStart,
  days,
  weekStarts = null,
  period = "week",
  timezone = "UTC",
  thresholdHours = 40,
  schedules = [],
  timeEntries = [],
  coverage = [],
  staff = [],
  settings = null,
  shiftLabel = (type, tag) => [type, tag].filter(Boolean).join(" "),
  includeCosts = false,
  now = new Date(),
}) {
  const zone = timezone || "UTC";
  const startOf = (key) => DateTime.fromISO(key, { zone }).startOf("day").toJSDate();
  const weekStartAt = startOf(days[0]);
  const weekEndAt = DateTime.fromISO(days[days.length - 1], { zone }).plus({ days: 1 }).startOf("day").toJSDate();
  const inWeek = (t) => new Date(t) >= weekStartAt && new Date(t) < weekEndAt;
  const daySet = new Set(days);
  const staffById = new Map(staff.map((p) => [idOf(p._id), p]));
  const nameOf = (id) => staffById.get(id)?.name || "Someone";

  const weekShifts = schedules.filter((s) => inWeek(s.startTime));
  const worked = weekShifts.filter((s) => !NOT_WORKED.has(s.status));
  const weekEntries = timeEntries.filter((e) => inWeek(e.clockInAt));
  const entryBySchedule = new Map(
    timeEntries.filter((e) => e.scheduleId).map((e) => [idOf(e.scheduleId), e]),
  );

  // ---- hours ----
  const byRole = new Map();
  const byDay = new Map(days.map((d) => [d, { date: d, scheduled: 0, worked: 0 }]));
  const roleRow = (role) => {
    const key = role || "unassigned";
    if (!byRole.has(key)) byRole.set(key, { role: key, scheduled: 0, worked: 0 });
    return byRole.get(key);
  };
  let scheduledTotal = 0;
  for (const s of worked) {
    const h = shiftHours(s);
    scheduledTotal += h;
    roleRow(s.role).scheduled += h;
    const day = byDay.get(dayKeyIn(s.startTime, zone));
    if (day) day.scheduled += h;
  }
  const shiftById = new Map(weekShifts.map((s) => [idOf(s._id), s]));
  let workedTotal = 0;
  for (const e of weekEntries) {
    const h = entryHours(e, now);
    workedTotal += h;
    const shift = e.scheduleId ? shiftById.get(idOf(e.scheduleId)) : null;
    const role = shift?.role || staffById.get(idOf(e.staffId))?.roles?.[0];
    roleRow(role).worked += h;
    const day = byDay.get(dayKeyIn(e.clockInAt, zone));
    if (day) day.worked += h;
  }

  // ---- hours needed (every spot in Weekly Needs / one-off needs) ----
  // Staffed hours only count spots with someone in them; "needed" counts
  // every spot, so leadership can see how much of a gap is open shifts.
  let neededHours = 0;
  let openHours = 0;
  for (const c of coverage) {
    const need = Number(c.requiredCount) || 0;
    const got = Math.min(need, Number(c.assignedCount) || 0);
    const len = c.startTime && c.endTime ? shiftHours(c) : 0;
    neededHours += need * len;
    openHours += (need - got) * len;
  }

  // ---- residents and budget (hours per resident day) ----
  const censusByDay = new Map((settings?.census || []).map((c) => [c.date, Number(c.residents)]));
  const typical = Number.isFinite(settings?.typicalCensus) ? settings.typicalCensus : null;
  let residentDays = 0;
  let hoursOnCountedDays = 0;
  let workedOnCountedDays = 0;
  let dailyCounted = 0;
  for (const d of days) {
    const residents = censusByDay.has(d) ? censusByDay.get(d) : typical;
    const row = byDay.get(d);
    row.residents = residents;
    if (residents === null || residents === undefined) continue;
    if (censusByDay.has(d)) dailyCounted += 1;
    residentDays += residents;
    hoursOnCountedDays += row.scheduled;
    workedOnCountedDays += row.worked;
  }
  const target = Number.isFinite(settings?.budgetHoursPerResidentDay) ? settings.budgetHoursPerResidentDay : null;
  const budget = residentDays > 0
    ? {
        residentDays,
        censusSource: dailyCounted === 7 ? "daily" : dailyCounted ? "mixed" : "typical",
        residentsPerDay: round1(residentDays / days.filter((d) => byDay.get(d).residents !== null && byDay.get(d).residents !== undefined).length),
        countedDays: days.filter((d) => byDay.get(d).residents !== null && byDay.get(d).residents !== undefined).length,
        scheduledPPD: round2(hoursOnCountedDays / residentDays),
        // If every open spot were filled.
        neededPPD: neededHours ? round2((hoursOnCountedDays + openHours) / residentDays) : null,
        workedPPD: workedOnCountedDays ? round2(workedOnCountedDays / residentDays) : null,
        targetPPD: target,
        budgetHours: target !== null ? round1(target * residentDays) : null,
        varianceHours: target !== null ? round1(hoursOnCountedDays - target * residentDays) : null,
      }
    : null;

  // ---- overtime (per payroll week, per person) ----
  // Walk each person's week in order; hours past the limit are overtime and
  // belong to the day of the shift that crosses it (and every one after).
  const payWeeks = (weekStarts && weekStarts.length ? weekStarts : [days[0]]).map((key) => ({
    key,
    from: startOf(key),
    to: DateTime.fromISO(key, { zone }).plus({ days: 7 }).startOf("day").toJSDate(),
  }));
  const allShiftIds = new Set(schedules.map((s) => idOf(s._id)));
  const perPerson = new Map();
  const personRow = (id) => {
    if (!perPerson.has(id)) perPerson.set(id, { weeks: new Map(), roles: new Map() });
    return perPerson.get(id);
  };
  const weekOf = (t) => payWeeks.find((w) => new Date(t) >= w.from && new Date(t) < w.to);
  const addEvent = (staffId, at, hours, role) => {
    const w = weekOf(at);
    if (!w) return;
    const p = personRow(staffId);
    if (!p.weeks.has(w.key)) p.weeks.set(w.key, []);
    p.weeks.get(w.key).push({ at: new Date(at), hours, role });
    if (role && daySet.has(dayKeyIn(at, zone))) p.roles.set(role, (p.roles.get(role) || 0) + hours);
  };
  for (const s of schedules) {
    if (NOT_WORKED.has(s.status)) continue;
    const entry = entryBySchedule.get(idOf(s._id));
    let h = shiftHours(s);
    if (entry) h = entry.clockOutAt ? entryHours(entry, now) : Math.max(entryHours(entry, now), h);
    addEvent(idOf(s.staffId), s.startTime, h, s.role);
  }
  for (const e of timeEntries) {
    if (e.scheduleId && allShiftIds.has(idOf(e.scheduleId))) continue;
    addEvent(idOf(e.staffId), e.clockInAt, entryHours(e, now), null);
  }
  const overtimePeople = [];
  for (const [id, p] of perPerson) {
    let otInPeriod = 0;
    let weeksOver = 0;
    let most = 0;
    let firstCross = null;
    for (const events of p.weeks.values()) {
      events.sort((a, b) => a.at - b.at);
      let total = 0;
      let crossedInPeriod = false;
      for (const ev of events) {
        const before = total;
        total += ev.hours;
        const ot = Math.max(0, total - Math.max(before, thresholdHours));
        if (ot > 0 && daySet.has(dayKeyIn(ev.at, zone))) {
          otInPeriod += ot;
          crossedInPeriod = true;
          if (!firstCross || ev.at < firstCross) firstCross = ev.at;
        }
      }
      if (crossedInPeriod) {
        weeksOver += 1;
        most = Math.max(most, total);
      }
    }
    if (otInPeriod > 0.05) {
      const mainRole = [...p.roles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        || staffById.get(id)?.roles?.[0] || null;
      overtimePeople.push({
        staffId: id,
        name: nameOf(id),
        role: mainRole,
        // Week: hours that week. Month: the person's biggest week.
        projectedHours: round1(most),
        overtimeHours: round1(otInPeriod),
        weeksOver,
        crossesOn: dayKeyIn(firstCross, zone),
        alreadyOver: firstCross <= now,
      });
    }
  }
  overtimePeople.sort((a, b) => b.overtimeHours - a.overtimeHours);

  // ---- costs (owners/admins only) ----
  let costs = null;
  if (includeCosts) {
    const roleRates = new Map((settings?.payRates || []).map((r) => [String(r.role).toLowerCase(), r.hourlyRate]));
    const personRates = new Map((settings?.staffRates || []).map((r) => [idOf(r.staffId), r.hourlyRate]));
    const mult = Number.isFinite(settings?.overtimeMultiplier) ? settings.overtimeMultiplier : 1.5;
    const rateFor = (staffId, role) =>
      personRates.has(staffId) ? personRates.get(staffId) : roleRates.has(String(role || "").toLowerCase()) ? roleRates.get(String(role).toLowerCase()) : null;
    if (roleRates.size || personRates.size) {
      const missing = new Set();
      let base = 0;
      for (const s of worked) {
        const r = rateFor(idOf(s.staffId), s.role);
        if (r === null) missing.add(s.role || "unassigned");
        else base += shiftHours(s) * r;
      }
      let premium = 0;
      for (const o of overtimePeople) {
        const r = rateFor(o.staffId, o.role);
        if (r !== null) premium += o.overtimeHours * r * (mult - 1);
      }
      let workedBase = 0;
      for (const e of weekEntries) {
        const shift = e.scheduleId ? shiftById.get(idOf(e.scheduleId)) : null;
        const role = shift?.role || staffById.get(idOf(e.staffId))?.roles?.[0];
        const r = rateFor(idOf(e.staffId), role);
        if (r !== null) workedBase += entryHours(e, now) * r;
      }
      costs = {
        scheduled: Math.round(base + premium),
        overtimePremium: Math.round(premium),
        worked: weekEntries.length ? Math.round(workedBase) : null,
        overtimeMultiplier: mult,
        missingRates: [...missing].sort(),
      };
    } else {
      costs = { scheduled: null, overtimePremium: null, worked: null, missingRates: [], needsRates: true };
    }
  }

  // ---- attendance: call-outs and no-shows ----
  const tally = () => new Map();
  const bump = (map, key, label, field) => {
    if (!map.has(key)) map.set(key, { key, label, callOuts: 0, noShows: 0 });
    map.get(key)[field] += 1;
  };
  const att = { byShift: tally(), byRole: tally(), byDay: tally() };
  let callOuts = 0;
  let noShows = 0;
  for (const s of weekShifts) {
    const field = s.status === "call_out" ? "callOuts" : s.status === "no_show" ? "noShows" : null;
    if (!field) continue;
    if (field === "callOuts") callOuts += 1; else noShows += 1;
    const shiftKey = `${s.shiftType || ""}:${s.shiftTag || ""}`;
    bump(att.byShift, shiftKey, s.shiftType ? shiftLabel(s.shiftType, s.shiftTag) : "Other times", field);
    bump(att.byRole, s.role || "unassigned", s.role || "unassigned", field);
    const d = dayKeyIn(s.startTime, zone);
    bump(att.byDay, d, d, field);
  }
  const sortAtt = (m) => [...m.values()].sort((a, b) => b.callOuts + b.noShows - (a.callOuts + a.noShows));

  // ---- open shifts ----
  let required = 0;
  let filled = 0;
  let unfilledPast = 0;
  let openUpcoming = 0;
  for (const c of coverage) {
    const need = Number(c.requiredCount) || 0;
    const got = Math.min(need, Number(c.assignedCount) || 0);
    required += need;
    filled += got;
    if (new Date(c.endTime) <= now) unfilledPast += need - got;
    else openUpcoming += need - got;
  }

  // ---- credentials (as of now) ----
  const soon = new Date(now.getTime() + 30 * DAY);
  const expired = [];
  const expiringSoon = [];
  for (const p of staff) {
    if (p.status && p.status !== "active") continue;
    const tags = new Set((p.certificationTags || []).map((t) => String(t).toLowerCase()));
    for (const c of p.credentials || []) {
      if (!tags.has(String(c.tag).toLowerCase())) continue;
      const at = new Date(c.expiresAt);
      if (Number.isNaN(at.getTime()) || at > soon) continue;
      const row = {
        staffId: idOf(p._id),
        name: p.name,
        tag: c.tag,
        expiresAt: at.toISOString(),
        daysLeft: Math.ceil((at - now) / DAY),
      };
      (at <= now ? expired : expiringSoon).push(row);
    }
  }
  expired.sort((a, b) => a.daysLeft - b.daysLeft);
  expiringSoon.sort((a, b) => a.daysLeft - b.daysLeft);

  // ---- turnover watch (last 4 weeks vs the 4 before) ----
  const recentStart = new Date(weekEndAt.getTime() - 28 * DAY);
  const priorStart = new Date(weekEndAt.getTime() - 56 * DAY);
  const signals = new Map();
  const sig = (id) => {
    if (!signals.has(id)) signals.set(id, { callOuts: 0, noShows: 0, recent: 0, prior: 0, weekly: [0, 0, 0, 0] });
    return signals.get(id);
  };
  for (const s of schedules) {
    const at = new Date(s.startTime);
    if (at >= weekEndAt || at < priorStart || at > now) continue;
    const g = sig(idOf(s.staffId));
    if (at >= recentStart) {
      if (s.status === "call_out") g.callOuts += 1;
      else if (s.status === "no_show") g.noShows += 1;
      else {
        g.recent += shiftHours(s);
        const w = Math.min(3, Math.floor((at - recentStart) / (7 * DAY)));
        g.weekly[w] += shiftHours(s);
      }
    } else if (!NOT_WORKED.has(s.status)) {
      g.prior += shiftHours(s);
    }
  }
  const turnoverWatch = [];
  for (const [id, g] of signals) {
    const person = staffById.get(id);
    if (!person || (person.status && person.status !== "active")) continue;
    const reasons = [];
    if (g.callOuts >= 2) reasons.push(`${g.callOuts} call-outs in 4 weeks`);
    if (g.noShows >= 1) reasons.push(`${g.noShows} no-show${g.noShows === 1 ? "" : "s"} in 4 weeks`);
    const otWeeks = g.weekly.filter((h) => h > thresholdHours).length;
    if (otWeeks >= 2) reasons.push(`overtime ${otWeeks} of the last 4 weeks`);
    if (g.prior >= 24 && g.recent < g.prior * 0.5) {
      reasons.push(`hours down ${Math.round((1 - g.recent / g.prior) * 100)}% vs the 4 weeks before`);
    }
    if (reasons.length) {
      turnoverWatch.push({ staffId: id, name: person.name, role: person.roles?.[0] || null, reasons, score: reasons.length });
    }
  }
  turnoverWatch.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return {
    period,
    weekStart,
    days,
    hours: {
      scheduled: round1(scheduledTotal),
      // Every spot in the needs (filled or not), and the part still unfilled.
      needed: round1(neededHours),
      open: round1(openHours),
      worked: weekEntries.length ? round1(workedTotal) : null,
      timeClockUsed: weekEntries.length > 0,
      byRole: [...byRole.values()]
        .map((r) => ({ ...r, scheduled: round1(r.scheduled), worked: round1(r.worked) }))
        .sort((a, b) => b.scheduled - a.scheduled),
      byDay: days.map((d) => {
        const r = byDay.get(d);
        return { date: d, scheduled: round1(r.scheduled), worked: round1(r.worked), residents: r.residents };
      }),
    },
    budget,
    costs,
    overtime: {
      thresholdHours,
      totalOvertimeHours: round1(overtimePeople.reduce((sum, o) => sum + o.overtimeHours, 0)),
      people: overtimePeople,
    },
    attendance: {
      callOuts,
      noShows,
      byShift: sortAtt(att.byShift),
      byRole: sortAtt(att.byRole),
      byDay: [...att.byDay.values()].sort((a, b) => a.key.localeCompare(b.key)),
    },
    openShifts: { required, filled, unfilledPast, openUpcoming },
    credentials: { expired, expiringSoon },
    turnoverWatch: turnoverWatch.slice(0, 15),
  };
}

module.exports = { buildLaborReport, dayKeyIn };
