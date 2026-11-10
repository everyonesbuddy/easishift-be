/**
 * HQ government contracts: what the SAM.gov feed searches for, which
 * listings are worth a look, and the deadlines that become to-dos. Pure.
 */
const DAY = 24 * 60 * 60 * 1000;

const STATUSES = {
  new: "New",
  reviewing: "Reviewing",
  bidding: "Bidding",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  passed: "Not for us",
};
const OPEN = new Set(["reviewing", "bidding"]);

/**
 * What we ask SAM.gov for each day: our software industry codes, and titles
 * with the words buyers use. Kept short, since SAM.gov limits requests a day.
 */
const SEARCHES = [
  { ncode: "513210", why: "Software publishers (513210)" },
  { ncode: "541511", why: "Custom software (541511)" },
  { ncode: "541512", why: "Computer systems design (541512)" },
  { title: "scheduling", why: "\"scheduling\" in the title" },
  { title: "workforce management", why: "\"workforce management\" in the title" },
  { title: "timekeeping", why: "\"timekeeping\" in the title" },
];

// A listing is worth a look when its title is about scheduling people.
const RELEVANT = [
  /schedul\w*\s+(software|system|solution|tool|application|platform|module|subscription|licen[cs]e|service)/i,
  /(staff|staffing|nurse|nursing|employee|personnel|shift|workforce|crew|physician|provider|caregiver)\s+(schedul|roster)/i,
  /workforce\s+management/i,
  /time\s*(and|&)\s*attendance/i,
  /timekeeping/i,
  /nurse\s+staffing|staffing\s+(software|system|solution)/i,
  /\b(kronos|ukg|qgenda|shiftwizard|smartlinx|api healthcare|when i work|deputy|humanity)\b/i,
];
const isRelevant = (title) => RELEVANT.some((r) => r.test(String(title || "")));

// Notices that aren't something you can respond to.
const SKIP_TYPES = /award notice|justification|sale of surplus|intent to bundle/i;

const date = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** A SAM.gov opportunity as a listing, or null if it isn't one for us. */
function fromSam(o, why = "") {
  if (!o?.noticeId || !o.title) return null;
  if (SKIP_TYPES.test(o.type || "") || SKIP_TYPES.test(o.baseType || "")) return null;
  if (String(o.active || "Yes").toLowerCase() === "no") return null;
  if (!isRelevant(o.title)) return null;
  const agency = String(o.fullParentPathName || o.department || "")
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    source: "sam",
    noticeId: String(o.noticeId),
    title: String(o.title).slice(0, 400),
    agency: (agency.length > 1 ? `${agency[0]} · ${agency[agency.length - 1]}` : agency[0] || "").slice(0, 300),
    level: "federal",
    state: o.placeOfPerformance?.state?.code || "",
    solicitationNumber: o.solicitationNumber || "",
    noticeType: o.type || o.baseType || "",
    setAside: o.typeOfSetAsideDescription || "",
    naics: o.naicsCode || "",
    url: o.uiLink || `https://sam.gov/opp/${o.noticeId}/view`,
    postedAt: date(o.postedDate),
    dueAt: date(o.responseDeadLine),
    matched: why,
  };
}

/** MM/dd/yyyy, as SAM.gov wants it. */
function samDate(d) {
  const x = new Date(d);
  return `${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCDate()).padStart(2, "0")}/${x.getUTCFullYear()}`;
}

/** The posted-date window for the next pull: from a day before the last one (or 60 days back), at most a year. */
function window(lastFetchAt, now = new Date()) {
  const from = lastFetchAt ? new Date(new Date(lastFetchAt).getTime() - DAY) : new Date(now.getTime() - 60 * DAY);
  const earliest = new Date(now.getTime() - 364 * DAY);
  return { postedFrom: samDate(from < earliest ? earliest : from), postedTo: samDate(now) };
}

const CHECKLIST = [
  "Read the whole listing and every attachment",
  "Note what they're asking for and how they'll score it",
  "Send questions before the questions deadline",
  "Check the registration they require (SAM.gov entity for federal, the state's vendor registration for state and county)",
  "Work out pricing",
  "Write the response: what we'll do, how, and who we've done it for",
  "Fill in and sign the required forms",
  "Submit, and save the confirmation",
];

const short = (d, tz) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(tz ? { timeZone: tz } : {}) });

/**
 * Deadline to-dos for the listings you're going after: questions due within
 * a week, responses due within two weeks, a bid-or-pass decision for ones
 * still being reviewed, and responses whose due date has passed.
 */
function deadlineTodos(listings, { now = new Date(), tz } = {}) {
  const out = [];
  for (const l of listings) {
    if (!OPEN.has(l.status)) continue;
    const id = String(l._id);
    const due = l.dueAt ? new Date(l.dueAt) : null;
    const q = l.questionsDueAt ? new Date(l.questionsDueAt) : null;
    const base = { refId: id, url: l.url || "", listing: l.title, agency: l.agency || "" };
    if (q && q >= now && q - now <= 7 * DAY) out.push({ ...base, kind: "questions", at: q, title: `Questions due ${short(q, tz)}`, detail: "Send any questions before this, or you can't ask later." });
    if (due && due < now) {
      out.push({ ...base, kind: "overdue", at: due, title: `Due date passed (${short(due, tz)})`, detail: l.status === "bidding" ? "Mark it submitted, or not for us." : "Mark it not for us, or fix the date." });
    } else if (due && due - now <= 14 * DAY) {
      out.push(
        l.status === "reviewing"
          ? { ...base, kind: "decide", at: due, title: `Bid or pass? Due ${short(due, tz)}`, detail: "Decide now, so there's time to write a good response." }
          : { ...base, kind: "due", at: due, title: `Response due ${short(due, tz)}`, detail: `${(l.checklist || []).filter((c) => c.done).length} of ${(l.checklist || []).length} steps done.` },
      );
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

module.exports = { STATUSES, SEARCHES, RELEVANT, isRelevant, fromSam, samDate, window, CHECKLIST, deadlineTodos };
