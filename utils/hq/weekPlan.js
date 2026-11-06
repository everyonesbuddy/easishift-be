/**
 * HQ "This week": each running play's weekly target turned into a specific
 * checklist. Calls and cold emails get the actual facilities or people,
 * spread Monday to Friday; content plays get the actual pieces to publish.
 * Pure: the controller loads the data and stores the list for the week.
 */
const DAY = 24 * 60 * 60 * 1000;
const fbRules = require("./facebook");

// What a play's touches are, by channel.
const TOUCH = { calls: "call", email: "email", linkedin: "linkedin" };
// Don't put someone back on the list this soon after the last touch.
const REST_DAYS = { call: 14, email: 30, linkedin: 30 };
// Leadership roles each buyer covers.
const ROLES = { director: ["executive_director", "administrator", "don"], operator: ["regional", "owner"] };
// Facilities that shouldn't be cold-called any more.
const DONE_STAGE = /won|customer|signed|not interested|do not|dnc|closed|lost|dead/i;
const STATUS_ORDER = ["ready", "scheduled", "drafting", "idea"];

/** How many to-dos a play gets this week (a play every few weeks gets 1 when it's due). */
const weeklyCount = (p) => (p.weeklyTarget >= 1 ? Math.ceil(p.weeklyTarget) : p.weeklyTarget > 0 ? 1 : 0);

/** Does a play get a specific list? Calls, cold emails and LinkedIn touches, and content. */
function listKind(p) {
  if (!p.active || !p.weeklyTarget) return null;
  if (p.countsFrom === "content") return "content";
  if (p.countsFrom === "activities" && p.channel === "facebook") return "facebook";
  if (p.countsFrom === "activities" && TOUCH[p.channel]) return "people";
  return null;
}

/** Spread n to-dos over Monday (0) to Friday (4), front-loaded. */
const dayFor = (i, n) => Math.min(4, Math.floor(i / Math.max(1, Math.ceil(n / 5))));

const phoneOf = (f) => f.frontDeskPhone || f.scheduler?.phone || "";
const place = (f) => [f?.city, f?.state].filter(Boolean).join(", ");

/** A facility as a calls / email row (scheduler plays). */
const facilityTodo = (f, touch) => ({
  kind: "facility",
  refId: String(f._id),
  facilityId: String(f._id),
  title: f.name,
  detail: [place(f), f.nextStep ? `Next: ${f.nextStep}` : "", f.tier ? `Tier ${f.tier}` : ""].filter(Boolean).join(" · "),
  phone: touch === "call" ? phoneOf(f) : "",
  email: touch === "email" ? f.scheduler?.email || "" : "",
});

/** A leader as a calls / email / LinkedIn row. */
function contactTodo(c, fById, touch) {
  const f = fById.get(String(c.facilityId));
  return {
    kind: "contact",
    refId: String(c._id),
    facilityId: c.facilityId ? String(c.facilityId) : null,
    title: [c.name || c.email, c.title].filter(Boolean).join(", "),
    detail: [f?.name || c.facilityName || c.group, place(f)].filter(Boolean).join(" · "),
    phone: touch === "call" ? c.phone || phoneOf(f || {}) : "",
    email: touch === "email" ? c.email : "",
  };
}

/**
 * Who a calls / email / LinkedIn play should reach next, best first.
 * Plays for schedulers go to facilities (the front desk or the scheduler);
 * plays for leaders go to the leaders themselves.
 */
function peopleFor(play, { facilities = [], contacts = [], lastTouch = new Map(), now = new Date(), weekEnd = null, skip = new Set() }) {
  const touch = TOUCH[play.channel];
  const rest = (REST_DAYS[touch] || 14) * DAY;
  const fresh = (id) => {
    const t = lastTouch.get(String(id));
    return !t || now - new Date(t) > rest;
  };
  const fById = new Map(facilities.map((f) => [String(f._id), f]));
  const open = (f) => f && !f.tenantId && !DONE_STAGE.test(f.stage || "");
  const tierOf = (f) => f?.tier || 9;

  if ((play.audience || []).includes("scheduler")) {
    const reach = (f) => (touch === "call" ? phoneOf(f) : touch === "email" ? f.scheduler?.email : "");
    const due = (f) => (f.nextDate && (!weekEnd || new Date(f.nextDate) < weekEnd) ? 0 : 1);
    return facilities
      .filter((f) => open(f) && reach(f) && !skip.has(String(f._id)) && fresh(f._id))
      .sort((a, b) => due(a) - due(b) || tierOf(a) - tierOf(b) || new Date(a.lastCallDate || 0) - new Date(b.lastCallDate || 0) || String(a.name).localeCompare(String(b.name)))
      .map((f) => facilityTodo(f, touch));
  }

  const roles = new Set((play.audience || []).flatMap((a) => ROLES[a] || []));
  const reach = (c) => (touch === "call" ? c.phone || phoneOf(fById.get(String(c.facilityId)) || {}) : touch === "email" ? c.email : c.linkedin);
  return contacts
    .filter((c) => roles.has(c.role) && reach(c) && !skip.has(String(c._id)) && fresh(c._id) && (!c.facilityId || open(fById.get(String(c.facilityId))) || !fById.has(String(c.facilityId))))
    .sort((a, b) => tierOf(fById.get(String(a.facilityId))) - tierOf(fById.get(String(b.facilityId))) || String(a.name).localeCompare(String(b.name)))
    .map((c) => ({ ...contactTodo(c, fById, touch), phone: touch === "call" ? reach(c) : "" }));
}

/**
 * Why a calls / email play's list is shorter than its target, in plain
 * words: how many are on file, and how many were left out for each reason.
 */
function whyShort(play, { facilities = [], contacts = [], lastTouch = new Map(), now = new Date() }) {
  const touch = TOUCH[play.channel];
  if (!touch) return null;
  const restDays = REST_DAYS[touch] || 14;
  const fresh = (id) => {
    const t = lastTouch.get(String(id));
    return !t || now - new Date(t) > restDays * DAY;
  };
  const fById = new Map(facilities.map((f) => [String(f._id), f]));
  const open = (f) => f && !f.tenantId && !DONE_STAGE.test(f.stage || "");
  const done = touch === "call" ? "called" : touch === "email" ? "emailed" : "messaged";
  const count = (list, test) => list.filter(test).length;
  if ((play.audience || []).includes("scheduler")) {
    const reach = (f) => (touch === "call" ? phoneOf(f) : touch === "email" ? f.scheduler?.email : "");
    const live = facilities.filter(open);
    return {
      total: facilities.length,
      of: "facilities",
      reasons: [
        [facilities.length - live.length, "are customers or closed"],
        [count(live, (f) => !reach(f)), touch === "call" ? "have no front-desk phone" : "have no scheduler email"],
        [count(live, (f) => reach(f) && !fresh(f._id)), `were ${done} in the last ${restDays} days`],
      ].filter(([n]) => n > 0),
      fix: touch === "call" ? "Add front-desk phone numbers on Facilities, or import more facilities." : "Add scheduler emails on Facilities.",
      page: "facilities",
    };
  }
  const roles = new Set((play.audience || []).flatMap((a) => ROLES[a] || []));
  const leaders = contacts.filter((c) => roles.has(c.role));
  const reach = (c) => (touch === "call" ? c.phone || phoneOf(fById.get(String(c.facilityId)) || {}) : touch === "email" ? c.email : c.linkedin);
  const live = leaders.filter((c) => !c.facilityId || !fById.has(String(c.facilityId)) || open(fById.get(String(c.facilityId))));
  const who = (play.audience || []).includes("operator") && !(play.audience || []).includes("director") ? "regional leaders and owners" : "DONs, EDs and administrators";
  return {
    total: leaders.length,
    of: who,
    reasons: [
      [leaders.length - live.length, "work at customers or closed facilities"],
      [count(live, (c) => !reach(c)), touch === "call" ? "have no phone" : touch === "email" ? "have no email" : "have no LinkedIn"],
      [count(live, (c) => reach(c) && !fresh(c._id)), `were ${done} in the last ${restDays} days`],
    ].filter(([n]) => n > 0),
    fix: `Add more ${who} on Leaders & contacts${touch === "call" ? ", with phone numbers" : touch === "email" ? ", with emails" : ""}.`,
    page: "people",
  };
}

/** Which weekday (0 = Monday) each of a play's n pieces goes out: spread out, never the weekend. */
const CONTENT_DAYS = { 1: [1], 2: [1, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4] };
const contentDay = (i, n) => (CONTENT_DAYS[n] ? CONTENT_DAYS[n][i] : i % 5);

/** A content play's open pieces, next first: ready before drafts before ideas, then by due date, then by name. */
function queueFor(play, items) {
  return items
    .filter((i) => String(i.playId) === String(play._id) && i.status !== "published")
    .sort(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        new Date(a.dueDate || 8.64e15) - new Date(b.dueDate || 8.64e15) ||
        String(a.title).localeCompare(String(b.title), "en", { numeric: true }),
    );
}

const contentTodo = (i) => ({ kind: "content", refId: String(i._id), title: i.title, detail: "", day: null });

/**
 * The to-dos to add for one play so its list reaches the weekly target.
 * `have` = to-dos already on this week's list for the play (refills only add).
 */
function todosFor(play, { items = [], facilities = [], contacts = [], groups = [], people = [], lastTouch, now = new Date(), weekStart = null, weekEnd = null, have = [], removed = new Set(), taken = new Set() }) {
  const kind = listKind(play);
  if (!kind) return [];
  const n = weeklyCount(play);
  const onList = new Set(have.map((t) => String(t.refId)));
  const skip = new Set([...onList, ...removed, ...taken]);

  if (kind === "facebook") return facebookTodos(play, { groups, people, now, have, removed, cap: n });

  if (kind === "content") {
    const mine = items.filter((i) => String(i.playId) === String(play._id));
    const since = weekStart ? new Date(weekStart) : null;
    const publishedThisWeek = mine.filter((i) => i.status === "published" && i.publishedAt && since && new Date(i.publishedAt) >= since);
    if (play.weeklyTarget < 1) {
      // Every few weeks: on the list only when nothing went out in that time.
      const last = mine.filter((i) => i.status === "published" && i.publishedAt).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
      const every = Math.round(1 / play.weeklyTarget) * 7 * DAY;
      if (last && !publishedThisWeek.includes(last) && now - new Date(last.publishedAt) < every) return [];
    }
    const out = publishedThisWeek.filter((i) => !skip.has(String(i._id))).map(contentTodo);
    const left = n - have.length - out.length;
    if (left > 0) out.push(...queueFor(play, items).filter((i) => !skip.has(String(i._id))).slice(0, left).map(contentTodo));
    return out.slice(0, Math.max(0, n - have.length));
  }

  const left = n - have.length;
  if (left <= 0) return [];
  return peopleFor(play, { facilities, contacts, lastTouch, now, weekEnd, skip })
    .slice(0, left)
    .map((t, i) => ({ ...t, day: dayFor(have.length + i, n) }));
}

/**
 * Facebook groups: each group's next step (join, admin, offer, then
 * answers) up to the target, plus everyone waiting on a message, which
 * isn't capped. A group can get its next step the same week once the
 * first is done (keyed by group and step).
 */
function facebookTodos(play, { groups = [], people = [], now = new Date(), have = [], removed = new Set(), cap = 0 }) {
  const onList = new Set(have.map((t) => `${t.refId}:${t.action}`));
  const open = (t) => !onList.has(`${t.refId}:${t.action}`) && !removed.has(String(t.refId));
  const byId = new Map(groups.map((x) => [String(x._id), x]));
  const pById = new Map(people.map((x) => [String(x._id), x]));
  // A to-do is still open while its step is still the group's or person's next step; until then it doesn't get another.
  const stillNext = (t) => {
    const step = t.kind === "fbgroup" ? (byId.get(String(t.refId)) ? fbRules.nextGroupStep(byId.get(String(t.refId)), now) : null) : pById.get(String(t.refId)) ? fbRules.nextPersonStep(pById.get(String(t.refId)), now) : null;
    return step?.action === t.action;
  };
  const pending = new Set(have.filter(stillNext).map((t) => String(t.refId)));
  const groupSlots = cap - have.filter((t) => t.kind === "fbgroup").length;
  const g = fbRules.groupTodos(groups, { n: 1000, now }).filter((t) => open(t) && !pending.has(t.refId)).slice(0, Math.max(0, groupSlots));
  const p = fbRules.personTodos(people, byId, { now }).filter((t) => open(t) && !pending.has(t.refId));
  return [...g, ...p].map((t) => ({ ...t, day: null }));
}

// ── Follow-ups: what happened on a call or email decides what comes next ──
/** Call and email outcomes you can log. */
const OUTCOMES = {
  booked: "Booked the setup",
  callback: "Call back",
  reached: "Talked",
  voicemail: "Left a voicemail",
  no_answer: "No answer",
  not_interested: "Not interested",
  wrong_number: "Wrong number",
  left: "No longer works there",
  replied: "They replied",
};
// Any of these, on any play, takes the person off cold lists and ends their sequences.
// "left" stops the person, not the building: someone else works there now.
const STOP = new Set(["booked", "not_interested", "wrong_number", "replied", "left"]);
const RETRY = new Set(["voicemail", "no_answer"]);
const MAX_TRIES = 3; // a voicemail or no answer gets tried up to 3 times, two days apart
const RETRY_DAYS = 2;
const STOP_DAYS = 180;

/** A Saturday or Sunday moves to Monday. */
function weekday(d) {
  const x = new Date(d);
  const wd = x.getUTCDay();
  if (wd === 6) x.setTime(x.getTime() + 2 * DAY);
  if (wd === 0) x.setTime(x.getTime() + DAY);
  return x;
}

/** People (facility or contact ids) with a stopping outcome in the last six months. */
function stoppedIds(acts, now = new Date()) {
  const out = new Set();
  for (const a of acts) {
    if (!STOP.has(a.outcome) || now - new Date(a.at) > STOP_DAYS * DAY) continue;
    if (a.outcome === "left" && !a.contactId) continue; // the scheduler left; the building stays on the list to find the new one
    if (a.contactId) out.add(String(a.contactId));
    if (a.facilityId && !a.contactId) out.add(String(a.facilityId));
  }
  return out;
}

/**
 * What a calls or email play owes this week because of what already
 * happened: email 2 and 3 on their days after email 1, a call-back on the
 * day they asked for, another try two days after a voicemail or no answer
 * (up to 3 tries). Anyone who replied, booked, said no, or was a wrong
 * number is done. Not capped by the weekly target.
 */
function followUpTodos(play, { acts = [], facilities = [], contacts = [], now = new Date(), weekStart, weekEnd, have = [] }) {
  const touch = TOUCH[play.channel];
  if (!touch || touch === "linkedin") return [];
  const forSchedulers = (play.audience || []).includes("scheduler");
  const fById = new Map(facilities.map((f) => [String(f._id), f]));
  const cById = new Map(contacts.map((c) => [String(c._id), c]));
  const start = new Date(weekStart);
  const end = new Date(weekEnd);
  const keyOf = (a) => (forSchedulers ? (a.facilityId ? String(a.facilityId) : "") : a.contactId ? String(a.contactId) : "");
  const groups = new Map();
  for (const a of acts) {
    if (String(a.playId) !== String(play._id) || a.kind !== touch) continue;
    const k = keyOf(a);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const onList = new Set(have.map((t) => `${t.refId}:${t.fkey || ""}`));
  const stopped = stoppedIds(acts, now);
  const out = [];
  for (const [id, list] of groups) {
    if (stopped.has(id)) continue;
    list.sort((a, b) => new Date(a.at) - new Date(b.at));
    const last = list[list.length - 1];
    let due = null;
    let fkey = "";
    let reason = "";
    let step = null;
    if (touch === "email") {
      const sent = Math.max(...list.map((a) => a.step || 1));
      const gaps = play.followUps || [];
      if (sent - 1 >= gaps.length) continue;
      due = weekday(new Date(new Date(list[0].at).getTime() + gaps[sent - 1] * DAY));
      step = sent + 1;
      fkey = `email:${step}`;
      reason = `Email ${step} · day ${gaps[sent - 1]}`;
    } else if (last.outcome === "callback") {
      due = weekday(last.nextDate ? new Date(last.nextDate) : new Date(new Date(last.at).getTime() + RETRY_DAYS * DAY));
      fkey = `callback:${new Date(last.at).toISOString().slice(0, 10)}`;
      reason = "Call back";
    } else if (RETRY.has(last.outcome)) {
      let tries = 0;
      for (let i = list.length - 1; i >= 0 && RETRY.has(list[i].outcome); i -= 1) tries += 1;
      if (tries >= MAX_TRIES) continue;
      due = weekday(new Date(new Date(last.at).getTime() + RETRY_DAYS * DAY));
      fkey = `retry:${tries + 1}:${new Date(last.at).toISOString().slice(0, 10)}`;
      reason = `Try again (${tries + 1} of ${MAX_TRIES})`;
    } else continue;
    if (due >= end || onList.has(`${id}:${fkey}`)) continue;
    const row = forSchedulers ? (fById.get(id) ? facilityTodo(fById.get(id), touch) : null) : cById.get(id) ? contactTodo(cById.get(id), fById, touch) : null;
    if (!row) continue;
    const day = due < start ? 0 : Math.min(6, Math.floor((due - start) / DAY));
    out.push({ ...row, day, step, fkey, reason: last.notes && touch === "call" ? `${reason}: ${String(last.notes).slice(0, 80)}` : reason });
  }
  return out.sort((a, b) => a.day - b.day);
}

/** What else you could do for a play beyond the list: the next people, or later content. */
function moreFor(play, ctx, limit = 8) {
  const kind = listKind(play);
  if (!kind) return [];
  const skip = new Set([...(ctx.have || []).map((t) => String(t.refId)), ...(ctx.removed || []), ...(ctx.taken || [])]);
  if (kind === "content") return queueFor(play, ctx.items || []).filter((i) => !skip.has(String(i._id))).slice(0, limit).map(contentTodo);
  if (kind === "facebook") {
    const keys = new Set((ctx.have || []).map((t) => `${t.refId}:${t.action}`));
    return fbRules.groupTodos(ctx.groups || [], { n: 1000, now: ctx.now }).filter((t) => !keys.has(`${t.refId}:${t.action}`) && !(ctx.removed || new Set()).has(t.refId)).slice(0, limit);
  }
  return peopleFor(play, { ...ctx, skip }).slice(0, limit);
}

module.exports = { OUTCOMES, STOP, stoppedIds, followUpTodos, facilityTodo, contactTodo, listKind, weeklyCount, dayFor, peopleFor, queueFor, todosFor, moreFor, facebookTodos, whyShort, contentDay, TOUCH };
