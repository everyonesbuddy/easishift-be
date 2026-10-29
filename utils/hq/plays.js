/**
 * HQ next plays: who to reach out to next and why. A pure function over data
 * the controller loads, so it's easy to test and to add rules to.
 *
 * Each play: { key, kind, priority (1 = do today), title, why, action, role,
 *              facilityId, contactId, tenantId, email }
 * `key` is stable, so a play that was marked done stays hidden until the
 * underlying facts change (see doneKeys).
 */
const { LEADERSHIP } = require("./roles");

const DAY = 24 * 60 * 60 * 1000;
const daysSince = (d, now) => (d ? (now - new Date(d)) / DAY : Infinity);

const ROLE_ORDER = ["don", "executive_director", "administrator", "regional", "owner"];
const pickLeader = (contacts = []) =>
  [...contacts]
    .filter((c) => LEADERSHIP.includes(c.role))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))[0] || null;

/**
 * @param {object} input
 * @param {Array} input.workspaces product signals per signup (see productSignals.js)
 * @param {Array} input.facilities HqFacility (lean)
 * @param {Array} input.contacts   HqContact (lean)
 * @param {Map|Object} input.signals email -> HqEmailSignal (lean)
 * @param {Map|Object} input.lastTouch facilityId/contactId -> Date of our last activity
 * @param {Set} input.doneKeys plays marked done
 * @param {Date} input.now
 */
function buildPlays({ workspaces = [], facilities = [], contacts = [], signals = {}, lastTouch = {}, doneKeys = new Set(), now = new Date() }) {
  const get = (m, k) => (m instanceof Map ? m.get(k) : m[k]);
  const plays = [];
  const add = (p) => {
    if (!doneKeys.has(p.key)) plays.push(p);
  };

  const contactsByFacility = new Map();
  const contactsByGroup = new Map();
  for (const c of contacts) {
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

  // ── Product: people who signed up ────────────────────────────────────────
  for (const w of workspaces) {
    const tenantId = String(w.tenantId);
    const facility = facilityByTenant.get(tenantId);
    const base = { tenantId, facilityId: facility ? String(facility._id) : null, email: w.ownerEmail };
    const age = daysSince(w.createdAt, now);

    if (!w.setupDone && age >= 2 && age <= 21) {
      add({
        ...base,
        key: `stuck:${tenantId}`,
        kind: "help",
        priority: 1,
        role: w.signupRole || "scheduler",
        title: `Help ${w.ownerName || "them"} finish setup at ${w.name}`,
        why: `Signed up ${Math.floor(age)} days ago and hasn't finished setup.`,
        action: "Call or email: offer 15 minutes to set it up together.",
      });
      continue;
    }

    if (w.active && !w.leadershipReached && age >= 7) {
      const leader = facility ? pickLeader(contactsByFacility.get(String(facility._id))) : null;
      add({
        ...base,
        key: `reach-leader:${tenantId}`,
        kind: "expand",
        priority: 1,
        role: leader?.role || "don",
        contactId: leader ? String(leader._id) : null,
        email: leader?.email || base.email,
        title: leader ? `Get ${leader.name} (${leader.title || "leadership"}) on the Monday email at ${w.name}` : `Find the DON or ED at ${w.name}`,
        why: `${w.ownerName || "Their scheduler"} is using it every week, but nobody in leadership sees the labor numbers yet.`,
        action: leader
          ? "Ask the scheduler to add them, or email them the Monday report sample."
          : "Ask the scheduler who runs the building, then add them in Labor settings.",
      });
    }

    if (w.active && w.leadershipReached && !w.paid && age >= 10) {
      add({
        ...base,
        key: `upgrade:${tenantId}:${w.trialEndsAt ? String(w.trialEndsAt).slice(0, 10) : "free"}`,
        kind: "upgrade",
        priority: w.trialDaysLeft !== null && w.trialDaysLeft <= 5 ? 1 : 2,
        role: "executive_director",
        title: `Ask ${w.name} to upgrade`,
        why:
          w.trialDaysLeft !== null
            ? `Active and leadership sees the numbers; trial ends in ${Math.max(0, w.trialDaysLeft)} days.`
            : "Active on Free and leadership sees the numbers.",
        action: "Send the overtime and call-out numbers from their Labor page with the price.",
      });
    }

    if (w.active === false && w.setupDone && w.lastActiveAt && daysSince(w.lastActiveAt, now) > 14 && daysSince(w.lastActiveAt, now) < 60) {
      add({
        ...base,
        key: `quiet:${tenantId}:${String(w.lastActiveAt).slice(0, 10)}`,
        kind: "rescue",
        priority: 2,
        role: w.signupRole || "scheduler",
        title: `Check in with ${w.name}`,
        why: `No one has logged in for ${Math.floor(daysSince(w.lastActiveAt, now))} days.`,
        action: "Ask what got in the way. One question, no pitch.",
      });
    }
  }

  // ── Email: people who clicked (real clicks, not scanners) ─────────────────
  for (const c of contacts) {
    if (!c.email) continue;
    const s = get(signals, c.email);
    if (!s || s.humanClicks < 1) continue;
    const touched = Math.min(daysSince(get(lastTouch, String(c._id)), now), daysSince(c.facilityId && get(lastTouch, String(c.facilityId)), now));
    if (touched < 7) continue;
    const hot = s.humanClicks >= 3 || daysSince(s.lastHumanClickAt, now) <= 3;
    if (s.humanClicks >= 2 || hot) {
      add({
        key: `clicked:${c._id}:${s.humanClicks}`,
        kind: "personal",
        priority: hot ? 1 : 2,
        role: c.role,
        contactId: String(c._id),
        facilityId: c.facilityId ? String(c.facilityId) : null,
        email: c.email,
        title: `Personal note to ${c.name || c.email}${c.group ? ` (${c.group})` : ""}`,
        why: `${s.humanClicks} real clicks on our emails${s.lastHumanClickAt ? `, last ${Math.floor(daysSince(s.lastHumanClickAt, now))} days ago` : ""}.`,
        action: "Email from your own inbox (not Klaviyo) or call. Reference what they clicked.",
      });
    }
  }

  // ── Groups: more than one building engaged → operator pitch ───────────────
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
      priority: 1,
      role: "regional",
      contactId: regional ? String(regional._id) : null,
      email: regional?.email || "",
      title: `Operator pitch to ${g.name}`,
      why: `${g.buildings.size} of their buildings are using WiserShifts or clicking our emails.`,
      action: regional ? `Reach ${regional.name} with a group view: one Monday email across buildings.` : "Find the regional VP or COO and pitch the group.",
    });
  }

  // ── Call list: due follow-ups from the cold-call tiers ───────────────────
  for (const f of facilities) {
    if (!f.nextDate || f.tenantId) continue;
    if (/not interested|wrong number|closed|already a customer|uses other/i.test(f.stage || "")) continue;
    const overdue = daysSince(f.nextDate, now);
    if (overdue < 0) continue;
    add({
      key: `followup:${f._id}:${new Date(f.nextDate).toISOString().slice(0, 10)}`,
      kind: "call",
      priority: f.tier && f.tier <= 2 ? 1 : 3,
      role: "scheduler",
      facilityId: String(f._id),
      title: `${f.nextStep || "Follow up"}: ${f.name}`,
      why: `${f.stage || "On the call list"}${f.tier ? `, tier ${f.tier}` : ""}. Due ${overdue < 1 ? "today" : overdue < 2 ? "yesterday" : `${Math.floor(overdue)} days ago`}.`,
      action: f.scheduler?.name ? `Ask for ${f.scheduler.name}.` : "Ask the front desk for whoever makes the schedule.",
    });
  }

  return plays.sort((a, b) => a.priority - b.priority);
}

module.exports = { buildPlays, pickLeader };
