/**
 * The managers' morning summary, as a pure function: today's shifts, what's
 * still open, what happened overnight, what's waiting on them, and who's
 * heading into overtime. Short enough for one text.
 */
const { DateTime } = require("luxon");

// "cna" → "CNA", "med_tech" → "Med Tech": care-role acronyms stay in capitals.
const ACRONYMS = new Set(["cna", "rn", "lpn", "lvn", "cma", "qma", "don", "adon", "ed", "np", "pt", "ot", "hha", "pca", "stna", "gna"]);
const role = (r) => String(r || "").split(/[_\s]+/).filter(Boolean).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(" ");
const first = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs, max = 3) => (xs.length > max ? `${xs.slice(0, max).join(", ")} and ${xs.length - max} more` : xs.join(", "));

/**
 * facts: {
 *   facility, timezone,
 *   shiftsToday,                      // published shifts starting today (not called out)
 *   open: [{ role, start }],          // today's slots still unfilled
 *   callouts: [{ name, role, start, coveredBy }], // called out in the last 24 hours, for today or later
 *   pendingTimeOff, pendingSwaps,
 *   overtime: [{ name, hours }],      // scheduled this week at or over the overtime line
 * }
 */
function buildMorningSummary(facts, manager, link) {
  const tz = facts.timezone || "UTC";
  const t = (d) => DateTime.fromJSDate(new Date(d), { zone: tz }).toFormat("h:mma").replace(":00", "").toLowerCase();
  const day = (d) => DateTime.fromJSDate(new Date(d), { zone: tz });
  const today = DateTime.now().setZone(tz);
  const when = (d) => (day(d).hasSame(today, "day") ? t(d) : `${day(d).toFormat("ccc")} ${t(d)}`);

  const parts = [];
  const openTxt = facts.open.length ? `${plural(facts.open.length, "slot")} still open (${list(facts.open.map((o) => `${t(o.start)} ${role(o.role)}`))})` : "every slot filled";
  parts.push(`${plural(facts.shiftsToday, "shift")} today, ${openTxt}.`);
  if (facts.callouts.length) {
    const covered = facts.callouts.filter((c) => c.coveredBy);
    const uncovered = facts.callouts.filter((c) => !c.coveredBy);
    const bits = [];
    if (covered.length) bits.push(list(covered.map((c) => `${c.coveredBy} is covering for ${c.name}`)));
    if (uncovered.length) bits.push(`${list(uncovered.map((c) => `${c.name} (${when(c.start)} ${role(c.role)})`))} still needs cover`);
    parts.push(`Call-outs: ${bits.join("; ")}.`);
  }
  const waiting = [];
  if (facts.pendingTimeOff) waiting.push(plural(facts.pendingTimeOff, "time-off request"));
  if (facts.pendingSwaps) waiting.push(plural(facts.pendingSwaps, "swap"));
  if (waiting.length) parts.push(`Waiting on you: ${waiting.join(", ")}.`);
  if (facts.overtime.length) parts.push(`Heading into overtime this week: ${list(facts.overtime.map((o) => `${o.name} (${o.hours}h)`))}.`);

  const needsYou = facts.open.length + facts.callouts.filter((c) => !c.coveredBy).length + (facts.pendingTimeOff || 0) + (facts.pendingSwaps || 0);
  const greeting = `Good morning, ${first(manager.name)}.`;
  const sms = `WiserShifts · ${facts.facility}: ${greeting} ${parts.join(" ")}${needsYou ? ` ${link}` : ""}`;
  const subject = needsYou ? `${facts.facility} today: ${plural(needsYou, "thing")} need${needsYou === 1 ? "s" : ""} you` : `${facts.facility} today: all covered`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;font-size:15px;line-height:1.55;color:#1D1D1F">
<p>${esc(greeting)}</p>
${parts.map((p) => `<p style="margin:0 0 10px">${esc(p)}</p>`).join("")}
<p style="margin:18px 0"><a href="${esc(link)}" style="display:inline-block;background:#007AFF;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">Open today</a></p>
<p style="font-size:12px;color:#6E6E73">You get this at 6 a.m. on days with shifts. Turn it off in your notification settings.</p></div>`;
  return { sms, subject, html, needsYou };
}

module.exports = { buildMorningSummary, role };
