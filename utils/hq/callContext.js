/**
 * What HQ actually knows about the person or building on a call or email
 * to-do, so the script fits the facts: where they are in the pipeline, who
 * the scheduler is, and what happened the last few times you reached out.
 * Nothing is assumed: no logged touch means "nothing logged yet".
 */
const { OUTCOMES } = require("./weekPlan");

const KIND = { call: "Call", email: "Email", linkedin: "LinkedIn", meeting: "Meeting", note: "Note", facebook: "Facebook" };
const TALKED = new Set(["booked", "reached", "callback", "replied"]);
const day = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/**
 * todo: a "facility" or "contact" to-do. acts: touches with that person (or
 * building), newest first. buildingActs: every touch at their building, so a
 * leader's row knows whether you spoke with the scheduler there. plays: id → play.
 */
function knownFor(todo, { facility = null, contact = null, acts = [], buildingActs = acts, plays = new Map() }) {
  const facts = [];
  if (facility?.tenantId) facts.push("Customer: this building has a WiserShifts workspace.");
  if (facility?.stage) facts.push(`Stage: ${facility.stage}`);
  if (facility?.scheduler?.name) facts.push(`Scheduler: ${facility.scheduler.name}${facility.scheduler.title ? `, ${facility.scheduler.title}` : ""}`);
  if (contact?.notes) facts.push(`About them: ${String(contact.notes).slice(0, 140)}`);

  const forScheduler = (a) => (plays.get(String(a.playId))?.audience || []).includes("scheduler");
  const atBuilding = buildingActs.filter((a) => facility && String(a.facilityId) === String(facility._id));
  const spokeWithScheduler = atBuilding.some((a) => forScheduler(a) && TALKED.has(a.outcome));
  const setupBooked = atBuilding.some((a) => forScheduler(a) && a.outcome === "booked");

  // Their own touches, plus (for a leader) what happened at their building, newest first.
  const seen = new Set();
  const all = [...acts, ...atBuilding].filter((a) => {
    const k = String(a._id || `${a.at}|${a.playId}|${a.outcome}`);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => new Date(b.at) - new Date(a.at));
  const line = (a) => {
    const play = plays.get(String(a.playId));
    const what = [KIND[a.kind] || "Touch", play ? `(${play.title})` : ""].filter(Boolean).join(" ");
    const outcome = OUTCOMES[a.outcome] || "";
    const notes = a.notes ? String(a.notes).replace(/\s+/g, " ").slice(0, 120) : "";
    return `${day(a.at)} · ${what}${outcome ? ` · ${outcome}` : ""}${notes ? `: ${notes}` : ""}`;
  };
  const history = all.slice(0, 4).map(line);
  if (!acts.length) {
    if (todo.kind === "contact") facts.push(all.length ? "You haven't reached out to them yet. Their building's history is below." : "No calls or emails logged with them or their building yet. This is a first contact.");
    else facts.push("No calls or emails logged with this building yet. This is a first contact.");
  }
  const talk = atBuilding.find((a) => forScheduler(a) && TALKED.has(a.outcome));
  return {
    facts,
    history,
    spokeWithScheduler,
    setupBooked,
    firstContact: !acts.length,
    // So the "you spoke with their scheduler" script fills in itself.
    schedulerName: facility?.scheduler?.name || "",
    spokeOn: talk ? day(talk.at) : "",
  };
}

module.exports = { knownFor };
