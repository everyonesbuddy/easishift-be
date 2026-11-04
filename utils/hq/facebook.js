/**
 * HQ Facebook: the groups where our buyers talk and the people we message
 * from them. Each group moves through one next step at a time (join as the
 * Page, ask the admin, post the offer once allowed, then keep answering);
 * each person from found to messaged to replied to a call booked. Pure.
 */
const DAY = 24 * 60 * 60 * 1000;

const GROUP_STATUSES = {
  found: "Found",
  requested: "Join requested",
  joined: "Joined",
  asked: "Admin messaged",
  approved: "Offer approved",
  declined: "No promotion",
  left: "Left",
};
// What a group allows: promotion by anyone, only with the admin's OK, only in a weekly thread, or never.
const PROMO = { unknown: "Not sure yet", ask: "Ask the admin first", thread: "Promo thread only", allowed: "Allowed", none: "No promotion" };
const PERSON_STATUSES = {
  to_message: "To message",
  messaged: "Messaged",
  replied: "Replied",
  call_booked: "Call booked",
  signed_up: "Signed up",
  not_interested: "Not interested",
};

// Actions you can log, with what they do to the group or person.
const GROUP_ACTIONS = {
  join: "Asked to join (as the Page)",
  joined: "Got in",
  admin: "Messaged the admin",
  admin_followup: "Followed up with the admin",
  approved: "Admin said yes",
  declined: "Admin said no",
  offer: "Posted the offer",
  answer: "Answered a question",
  post: "Posted something helpful",
};
const PERSON_ACTIONS = {
  message: "Messaged them",
  followup: "Followed up",
  replied: "They replied",
  call_booked: "Call booked",
  signed_up: "They signed up",
  not_interested: "Not interested",
};

const FOLLOW_UP_DAYS = { admin: 5, person: 3 };
const daysSince = (d, now) => (d ? (now - new Date(d)) / DAY : Infinity);
const agoText = (d, now) => {
  const days = Math.floor(daysSince(d, now));
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};
/** A link as typed ("facebook.com/groups/…") made into a full one, so it opens Facebook and not a page in HQ. */
function fullUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return `https:${s}`;
  return `https://${s.replace(/^\/+/, "")}`;
}
const offerOk = (g) => g.status === "approved" || g.promo === "allowed" || g.promo === "thread";

/**
 * A group's next step, or null. The admin message comes after joining and
 * before any offer; once the offer is out (or promotion is off) it's helpful
 * answers from then on.
 */
function nextGroupStep(g, now = new Date()) {
  const name = g.name;
  if (g.status === "left") return null;
  if (g.status === "found") return { action: "join", title: `Join ${name} as the WiserShifts Page`, why: g.allowsPages === "no" ? "This group doesn't take Pages; join from a profile or skip it." : "Switch to the Page, then ask to join. Answer the questions honestly." };
  if (g.status === "requested") return { action: "joined", title: `See if ${name} let the Page in`, why: g.requestedAt ? `Asked ${agoText(g.requestedAt, now)}. Check the group, or your Page's notifications.` : "" };
  if (g.status === "joined" && (g.promo === "ask" || g.promo === "unknown" || !g.promo) && !g.askedAt) return { action: "admin", title: `Message the admin of ${name}`, why: "Ask before posting the offer. Use the admin script." };
  if (g.status === "asked" && daysSince(g.askedAt, now) >= FOLLOW_UP_DAYS.admin && !g.adminFollowedUpAt) return { action: "admin_followup", title: `Follow up with the admin of ${name}`, why: `No answer in ${Math.floor(daysSince(g.askedAt, now))} days. One polite nudge, then let it go.` };
  if (offerOk(g) && !g.offerAt) return { action: "offer", title: `Post the offer in ${name}`, why: g.promo === "thread" ? "Only in their promo thread." : "The admin said yes. Plain text, as the Page." };
  return { action: "answer", title: `Answer a question in ${name}`, why: "Real help, no pitch. Share a template if it answers the question." };
}

/** A person's next step, or null. */
function nextPersonStep(p, now = new Date()) {
  const name = p.name || "them";
  const where = p.groupName ? ` (from ${p.groupName})` : "";
  if (p.status === "to_message") return { action: "message", title: `Message ${name}${where}`, why: p.said ? `They said: "${String(p.said).slice(0, 120)}"` : "Use the commenter script." };
  if (p.status === "messaged" && daysSince(p.followedUpAt || p.messagedAt, now) >= FOLLOW_UP_DAYS.person && !p.followedUpAt) return { action: "followup", title: `Follow up with ${name}${where}`, why: `No reply in ${Math.floor(daysSince(p.messagedAt, now))} days.` };
  if (p.status === "replied") return { action: "call_booked", title: `Book the 30-minute setup with ${name}`, why: "They replied. Pick a time and build their first week together." };
  return null;
}

/** What logging an action changes on a group. */
function groupChange(action, now = new Date()) {
  return (
    {
      join: { status: "requested", requestedAt: now },
      joined: { status: "joined", joinedAt: now },
      admin: { status: "asked", askedAt: now },
      admin_followup: { adminFollowedUpAt: now },
      approved: { status: "approved", approvedAt: now },
      declined: { status: "declined", promo: "none" },
      offer: { offerAt: now, lastTouchAt: now },
      answer: { lastAnswerAt: now, lastTouchAt: now },
      post: { lastAnswerAt: now, lastTouchAt: now },
    }[action] || null
  );
}

/** What logging an action changes on a person. */
function personChange(action, now = new Date()) {
  return (
    {
      message: { status: "messaged", messagedAt: now },
      followup: { followedUpAt: now },
      replied: { status: "replied", repliedAt: now },
      call_booked: { status: "call_booked", callAt: now },
      signed_up: { status: "signed_up" },
      not_interested: { status: "not_interested" },
    }[action] || null
  );
}

/**
 * This week's group to-dos for the Facebook groups play: every group's
 * step that moves it forward (join, admin, follow-up, offer) first, then
 * answers in the groups you've helped least lately, up to the target.
 */
function groupTodos(groups, { n, now = new Date(), skip = new Set() }) {
  const live = groups.filter((g) => g.status !== "left" && !skip.has(String(g._id)));
  const steps = live.map((g) => ({ g, s: nextGroupStep(g, now) })).filter((x) => x.s);
  const forward = steps.filter((x) => x.s.action !== "answer").sort((a, b) => (a.g.priority || 2) - (b.g.priority || 2) || (b.g.members || 0) - (a.g.members || 0));
  const answers = steps
    .filter((x) => x.s.action === "answer")
    .sort((a, b) => (a.g.priority || 2) - (b.g.priority || 2) || new Date(a.g.lastAnswerAt || 0) - new Date(b.g.lastAnswerAt || 0) || (b.g.members || 0) - (a.g.members || 0));
  return [...forward, ...answers].slice(0, Math.max(0, n)).map(({ g, s }) => ({
    kind: "fbgroup",
    refId: String(g._id),
    action: s.action,
    title: s.title,
    detail: [s.why, g.members ? `${Number(g.members).toLocaleString("en-US")} members` : ""].filter(Boolean).join(" · "),
    url: fullUrl(g.url),
  }));
}

/** Everyone waiting on a message, follow-up or call (not capped by the target). */
function personTodos(people, groupsById = new Map(), { now = new Date(), skip = new Set() } = {}) {
  return people
    .filter((p) => !skip.has(String(p._id)))
    .map((p) => ({ p, s: nextPersonStep({ ...p, groupName: groupsById.get(String(p.groupId))?.name || "" }, now) }))
    .filter((x) => x.s)
    .map(({ p, s }) => ({ kind: "fbperson", refId: String(p._id), action: s.action, title: s.title, detail: s.why, url: fullUrl(p.profileUrl) }));
}

module.exports = { fullUrl, GROUP_STATUSES, PROMO, PERSON_STATUSES, GROUP_ACTIONS, PERSON_ACTIONS, nextGroupStep, nextPersonStep, groupChange, personChange, groupTodos, personTodos };
