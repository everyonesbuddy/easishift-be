/**
 * HQ "This week": each running play's weekly target turned into a specific
 * checklist. Calls and cold emails get the actual facilities or people,
 * spread Monday to Friday; content plays get the actual pieces to publish.
 * Pure: the controller loads the data and stores the list for the week.
 */
const DAY = 24 * 60 * 60 * 1000;

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
  if (p.countsFrom === "activities" && TOUCH[p.channel]) return "people";
  return null;
}

/** Spread n to-dos over Monday (0) to Friday (4), front-loaded. */
const dayFor = (i, n) => Math.min(4, Math.floor(i / Math.max(1, Math.ceil(n / 5))));

const phoneOf = (f) => f.frontDeskPhone || f.scheduler?.phone || "";
const place = (f) => [f?.city, f?.state].filter(Boolean).join(", ");

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
      .map((f) => ({
        kind: "facility",
        refId: String(f._id),
        facilityId: String(f._id),
        title: f.name,
        detail: [place(f), f.nextStep ? `Next: ${f.nextStep}` : "", f.tier ? `Tier ${f.tier}` : ""].filter(Boolean).join(" · "),
        phone: touch === "call" ? phoneOf(f) : "",
        email: touch === "email" ? f.scheduler?.email || "" : "",
      }));
  }

  const roles = new Set((play.audience || []).flatMap((a) => ROLES[a] || []));
  const reach = (c) => (touch === "call" ? c.phone || phoneOf(fById.get(String(c.facilityId)) || {}) : touch === "email" ? c.email : c.linkedin);
  return contacts
    .filter((c) => roles.has(c.role) && reach(c) && !skip.has(String(c._id)) && fresh(c._id) && (!c.facilityId || open(fById.get(String(c.facilityId))) || !fById.has(String(c.facilityId))))
    .sort((a, b) => tierOf(fById.get(String(a.facilityId))) - tierOf(fById.get(String(b.facilityId))) || String(a.name).localeCompare(String(b.name)))
    .map((c) => {
      const f = fById.get(String(c.facilityId));
      return {
        kind: "contact",
        refId: String(c._id),
        facilityId: c.facilityId ? String(c.facilityId) : null,
        title: [c.name || c.email, c.title].filter(Boolean).join(", "),
        detail: [f?.name || c.facilityName || c.group, place(f)].filter(Boolean).join(" · "),
        phone: touch === "call" ? reach(c) : "",
        email: touch === "email" ? c.email : "",
      };
    });
}

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
function todosFor(play, { items = [], facilities = [], contacts = [], lastTouch, now = new Date(), weekStart = null, weekEnd = null, have = [], removed = new Set(), taken = new Set() }) {
  const kind = listKind(play);
  if (!kind) return [];
  const n = weeklyCount(play);
  const onList = new Set(have.map((t) => String(t.refId)));
  const skip = new Set([...onList, ...removed, ...taken]);

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

/** What else you could do for a play beyond the list: the next people, or later content. */
function moreFor(play, ctx, limit = 8) {
  const kind = listKind(play);
  if (!kind) return [];
  const skip = new Set([...(ctx.have || []).map((t) => String(t.refId)), ...(ctx.removed || []), ...(ctx.taken || [])]);
  if (kind === "content") return queueFor(play, ctx.items || []).filter((i) => !skip.has(String(i._id))).slice(0, limit).map(contentTodo);
  return peopleFor(play, { ...ctx, skip }).slice(0, limit);
}

module.exports = { listKind, weeklyCount, dayFor, peopleFor, queueFor, todosFor, moreFor, TOUCH };
