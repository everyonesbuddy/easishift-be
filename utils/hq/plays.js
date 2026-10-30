/**
 * HQ "to do now": who to reach and why, from product use, Klaviyo clicks,
 * replies, calculator emails and the call list. A pure function over data the
 * controller loads, so it's easy to test and to add rules to. (Content to-dos
 * are in contentPlays.js.)
 *
 * Each item: { key, kind, priority (1 = today), channel, audiences, title,
 *              why, action, role, facilityId, contactId, tenantId, email }
 * `key` is stable, so an item marked done stays hidden until the facts
 * behind it change (see doneKeys).
 */
const { LEADERSHIP } = require("./roles");

const DAY = 24 * 60 * 60 * 1000;
const daysSince = (d, now) => (d ? (now - new Date(d)) / DAY : Infinity);
const agoText = (d, now) => {
  const n = Math.floor(daysSince(d, now));
  return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Which buyer page an item belongs on, from a person's role. */
const audiencesFor = (role) =>
  role === "scheduler" ? ["scheduler"] : ["regional", "owner"].includes(role) ? ["operator"] : LEADERSHIP.includes(role) ? ["director"] : ["scheduler", "director"];

const ROLE_ORDER = ["don", "executive_director", "administrator", "regional", "owner"];
const pickLeader = (contacts = []) =>
  [...contacts]
    .filter((c) => LEADERSHIP.includes(c.role))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))[0] || null;

/** "/calculators/hours-per-resident-day-calculator?utm…" → "the hours per resident day calculator" (pure). */
function pageName(url = "") {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return "";
  }
  const calc = path.match(/^\/calculators\/([a-z-]+?)(?:-calculator)?\/?$/);
  if (calc) return `the ${calc[1].replace(/-/g, " ")} calculator`;
  const role = path.match(/^\/for\/(schedulers|directors|operators)/);
  if (role) return `the page for ${role[1]}`;
  const blog = path.match(/^\/blog\/([a-z0-9-]+)/);
  if (blog) return `the blog post "${blog[1].replace(/-/g, " ")}"`;
  if (path === "/signup-tenant") return "the signup page";
  if (path === "/" || path === "") return "the home page";
  if (path === "/pricing") return "pricing";
  return path;
}

const CALC_NAMES = {
  "call-out-cost": "call-out cost",
  "overtime-cost": "overtime cost",
  "payroll-accuracy": "payroll accuracy",
  "time-clock-accuracy": "payroll accuracy",
  "turnover-roi": "turnover",
  "cost-leak": "cost leak",
  "hours-per-resident-day": "hours per resident day",
  "schedule-coverage": "schedule coverage",
};

/**
 * @param {object} input
 * @param {Array} input.workspaces product signals per signup (productSignals.js)
 * @param {Array} input.facilities HqFacility (lean)
 * @param {Array} input.contacts   HqContact (lean)
 * @param {Map|Object} input.signals email -> HqEmailSignal (lean)
 * @param {Map|Object} input.lastTouch facilityId/contactId -> Date of our last call/email/meeting
 * @param {Array} input.leads recent HqLead (calculator / newsletter emails)
 * @param {Set} input.doneKeys items marked done
 * @param {Date} input.now
 */
function buildPlays({ workspaces = [], facilities = [], contacts = [], signals = {}, lastTouch = {}, leads = [], doneKeys = new Set(), now = new Date() }) {
  const get = (m, k) => (m instanceof Map ? m.get(k) : m[k]);
  const plays = [];
  const add = (p) => {
    if (!doneKeys.has(p.key)) plays.push(p);
  };
  const touchedSince = (c) => Math.min(daysSince(get(lastTouch, String(c._id)), now), daysSince(c.facilityId && get(lastTouch, String(c.facilityId)), now));

  const contactsByFacility = new Map();
  const contactsByGroup = new Map();
  const contactByEmail = new Map();
  for (const c of contacts) {
    if (c.email) contactByEmail.set(c.email, c);
    if (c.facilityId) {
      const k = String(c.facilityId);
      contactsByFacility.set(k, [...(contactsByFacility.get(k) || []), c]);
    }
    if (c.group) {
      const g = c.group.toLowerCase();
      contactsByGroup.set(g, [...(contactsByGroup.get(g) || []), c]);
    }
  }
  const facilityByTenant = new Map(facilities.filter((f) => f.tenantId).map((f) => [String(f.tenantId), f]));
  const facilityName = new Map(facilities.map((f) => [String(f._id), f.name]));

  // ── Signups ──────────────────────────────────────────────────────────────
  for (const w of workspaces) {
    const tenantId = String(w.tenantId);
    const facility = facilityByTenant.get(tenantId);
    const base = { tenantId, facilityId: facility ? String(facility._id) : null, email: w.ownerEmail };
    const age = daysSince(w.createdAt, now);
    const who = w.ownerName || "they";

    if (!w.setupDone && age >= 2 && age <= 21) {
      add({
        ...base,
        key: `stuck:${tenantId}`,
        kind: "help",
        channel: "calls",
        priority: 1,
        role: w.signupRole || "scheduler",
        audiences: audiencesFor(w.signupRole || "scheduler"),
        title: `Help ${who} finish setting up ${w.name}`,
        why: `Signed up ${agoText(w.createdAt, now)}${w.heardAbout ? ` (heard about us from ${w.heardAbout})` : ""} and hasn't finished setup.${w.staffCount > 1 ? ` ${plural(w.staffCount, "staff member")} added so far.` : ""}`,
        action: "Call or email: offer 15 minutes to build their first week together.",
      });
      continue;
    }

    if (w.active && !w.leadershipReached && age >= 7) {
      const leader = facility ? pickLeader(contactsByFacility.get(String(facility._id))) : null;
      add({
        ...base,
        key: `reach-leader:${tenantId}`,
        kind: "expand",
        channel: "calls",
        priority: 1,
        role: leader?.role || "don",
        audiences: ["director"],
        contactId: leader ? String(leader._id) : null,
        email: leader?.email || base.email,
        title: leader ? `Get ${leader.name} (${leader.title || "leadership"}) on the Monday labor email at ${w.name}` : `Find the DON or ED at ${w.name}`,
        why: `${w.ownerName || "Their scheduler"} has made ${plural(w.shifts14, "shift")} in two weeks, but nobody in leadership sees the labor numbers yet.`,
        action: leader ? "Call them with last week's numbers, or ask the scheduler to add them in Labor settings." : "Ask the scheduler who runs the building, then add them in Labor settings.",
      });
    }

    if (w.active && w.leadershipReached && !w.paid && age >= 10) {
      add({
        ...base,
        key: `upgrade:${tenantId}:${w.trialEndsAt ? String(w.trialEndsAt).slice(0, 10) : "free"}`,
        kind: "upgrade",
        channel: "calls",
        priority: w.trialDaysLeft !== null && w.trialDaysLeft <= 5 ? 1 : 2,
        role: "executive_director",
        audiences: ["director"],
        title: `Ask ${w.name} to upgrade`,
        why:
          w.trialDaysLeft !== null
            ? `Active, leadership sees the numbers, and the trial ends in ${plural(Math.max(0, w.trialDaysLeft), "day")}.`
            : "Active on Free and leadership sees the numbers.",
        action: "Send their own overtime and call-out numbers from the Labor page, with the price.",
      });
    }

    if (w.active === false && w.setupDone && w.lastActiveAt && daysSince(w.lastActiveAt, now) > 14 && daysSince(w.lastActiveAt, now) < 60) {
      add({
        ...base,
        key: `quiet:${tenantId}:${String(w.lastActiveAt).slice(0, 10)}`,
        kind: "rescue",
        channel: "calls",
        priority: 2,
        role: w.signupRole || "scheduler",
        audiences: audiencesFor(w.signupRole || "scheduler"),
        title: `Check in with ${w.name}`,
        why: `No one has logged in for ${Math.floor(daysSince(w.lastActiveAt, now))} days. They had ${plural(w.staffCount, "staff member")} set up.`,
        action: "Ask what got in the way. One question, no pitch.",
      });
    }
  }

  // ── People who replied ───────────────────────────────────────────────────
  for (const c of contacts) {
    if (!c.emailReply || touchedSince(c) < 7) continue;
    if (/^(no|none|n\/a|-)$/i.test(c.emailReply.trim())) continue;
    add({
      key: `replied:${c._id}:${c.emailReply.slice(0, 40)}`,
      kind: "reply",
      channel: "email",
      priority: 1,
      role: c.role,
      audiences: audiencesFor(c.role),
      contactId: String(c._id),
      facilityId: c.facilityId ? String(c.facilityId) : null,
      email: c.email,
      title: `Answer ${c.name || c.email}${c.group ? ` (${c.group})` : ""}`,
      why: `They replied: "${c.emailReply.slice(0, 160)}"`,
      action: "Answer from your own inbox today. If they asked for numbers, offer the free labor snapshot.",
    });
  }

  // ── Klaviyo: people who really clicked (not scanners) ────────────────────
  for (const c of contacts) {
    if (!c.email) continue;
    const s = get(signals, c.email);
    if (!s || s.humanClicks < 1 || s.suppressed || s.unsubscribed) continue;
    if (touchedSince(c) < 7) continue;
    const recent = daysSince(s.lastHumanClickAt, now) <= 3;
    const hot = s.humanClicks >= 3 || recent;
    if (!(s.humanClicks >= 2 || hot)) continue;
    const email = s.lastClickCampaign || (s.campaignsClicked || []).slice(-1)[0] || "";
    const page = pageName(s.lastClickUrl);
    const what = s.lastClickFromFlow ? "a Klaviyo follow-up email" : "our Klaviyo newsletter";
    add({
      key: `clicked:${c._id}:${s.humanClicks}`,
      kind: "personal",
      channel: "email",
      priority: hot ? 1 : 2,
      role: c.role,
      audiences: audiencesFor(c.role),
      contactId: String(c._id),
      facilityId: c.facilityId ? String(c.facilityId) : null,
      email: c.email,
      title: `Personal note to ${c.name || c.email}${c.facilityId && facilityName.get(String(c.facilityId)) ? ` at ${facilityName.get(String(c.facilityId))}` : c.group ? ` (${c.group})` : ""}`,
      why: `Clicked ${email ? `"${email}" in ${what}` : what}${page ? ` and opened ${page}` : ""} ${agoText(s.lastHumanClickAt, now)}. ${plural(s.humanClicks, "real click")} in all${s.botClicks ? ` (plus ${plural(s.botClicks, "scanner click")} we ignore)` : ""}.`,
      action: page
        ? `Send a two-line note from your own inbox (not Klaviyo) about ${page}, then call if they reply.`
        : "Send a two-line note from your own inbox (not Klaviyo) about what they clicked, then call if they reply.",
    });
  }

  // ── Calculator and newsletter emails from the website ────────────────────
  const seenLead = new Set();
  for (const l of leads) {
    if (!l.email || seenLead.has(l.email) || daysSince(l.createdAt, now) > 10) continue;
    seenLead.add(l.email);
    const s = get(signals, l.email);
    if (s?.suppressed || s?.unsubscribed) continue;
    const c = contactByEmail.get(l.email);
    if (c && touchedSince(c) <= daysSince(l.createdAt, now)) continue; // already followed up
    const calc = l.source?.startsWith("calculator:") ? CALC_NAMES[l.source.slice(11)] || l.source.slice(11).replace(/-/g, " ") : null;
    const audiences = c ? audiencesFor(c.role) : calc && /hours per resident|schedule coverage/.test(calc) ? ["director"] : ["scheduler", "director"];
    add({
      key: `lead:${l.email}:${String(l.createdAt).slice(0, 10)}`,
      kind: "lead",
      channel: "email",
      priority: daysSince(l.createdAt, now) <= 2 ? 1 : 2,
      role: c?.role || "other",
      audiences,
      contactId: c ? String(c._id) : null,
      facilityId: c?.facilityId ? String(c.facilityId) : null,
      email: l.email,
      title: `Follow up with ${c?.name || l.email}${l.company ? ` (${l.company})` : ""}`,
      why: calc
        ? `Used the ${calc} calculator ${agoText(l.createdAt, now)}${l.summary ? `: ${l.summary}` : ""}.${l.newsletter ? " Joined the newsletter." : ""}`
        : `Signed up for the newsletter ${agoText(l.createdAt, now)}.`,
      action: calc
        ? "Reply personally about their result and offer to work it out from their real schedule, free."
        : "Send a short welcome from your own inbox and ask what they'd like to read about.",
    });
  }

  // ── Groups: more than one building engaged → operator pitch ──────────────
  const groups = new Map();
  const bump = (g, what) => {
    if (!g) return;
    const k = g.toLowerCase();
    const e = groups.get(k) || { name: g, buildings: new Set(), contacts: contactsByGroup.get(k) || [] };
    e.buildings.add(what);
    groups.set(k, e);
  };
  for (const w of workspaces) {
    const f = facilityByTenant.get(String(w.tenantId));
    if (f?.group && w.active) bump(f.group, `t:${w.tenantId}`);
  }
  for (const c of contacts) {
    const s = c.email && get(signals, c.email);
    if (c.group && s && s.humanClicks >= 1) bump(c.group, c.facilityId ? `f:${c.facilityId}` : `c:${c._id}`);
  }
  for (const g of groups.values()) {
    if (g.buildings.size < 2) continue;
    const regional = g.contacts.find((c) => c.role === "regional" || c.role === "owner") || null;
    add({
      key: `group:${g.name.toLowerCase()}:${g.buildings.size}`,
      kind: "operator",
      channel: "email",
      priority: 1,
      role: "regional",
      audiences: ["operator"],
      contactId: regional ? String(regional._id) : null,
      email: regional?.email || "",
      title: `Pitch ${g.name} as a group`,
      why: `${g.buildings.size} of their buildings are using WiserShifts or really clicking our emails.`,
      action: regional ? `Cold email ${regional.name}: one Monday labor email across their buildings, starting with a one-building pilot.` : "Find the regional VP or COO, then pitch the group.",
    });
  }

  // ── Call list: call-backs that are due ───────────────────────────────────
  for (const f of facilities) {
    if (!f.nextDate || f.tenantId) continue;
    if (/not interested|wrong number|closed|already a customer|uses other/i.test(f.stage || "")) continue;
    const overdue = daysSince(f.nextDate, now);
    if (overdue < 0) continue;
    add({
      key: `followup:${f._id}:${new Date(f.nextDate).toISOString().slice(0, 10)}`,
      kind: "call",
      channel: "calls",
      priority: f.tier && f.tier <= 2 ? 1 : 3,
      role: "scheduler",
      audiences: ["scheduler"],
      facilityId: String(f._id),
      title: `${f.nextStep || "Call back"}: ${f.name}`,
      why: `${f.stage || "On the call list"}${f.tier ? `, tier ${f.tier}` : ""}. Due ${overdue < 1 ? "today" : agoText(f.nextDate, now)}.`,
      action: f.scheduler?.name ? `Ask for ${f.scheduler.name}.` : "Ask the front desk who makes the schedule.",
    });
  }

  return plays.sort((a, b) => a.priority - b.priority);
}

module.exports = { buildPlays, pickLeader, pageName, audiencesFor };
