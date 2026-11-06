/**
 * HQ history: look back at any period. For each campaign: how many got done
 * against its target, what happened on the calls and emails, and the log of
 * every call, email, post and Facebook touch, newest first.
 */
const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
const HqActivity = require("../models/hqActivityModel");
const HqContentItem = require("../models/hqContentItemModel");
const HqFacility = require("../models/hqFacilityModel");
const HqContact = require("../models/hqContactModel");
const HqFbGroup = require("../models/hqFbGroupModel");
const HqFbPerson = require("../models/hqFbPersonModel");
const Tenant = require("../models/tenantModel");
const plan = require("../utils/hq/weekPlan");
const history = require("../utils/hq/history");

const KIND = { call: "Call", email: "Email", linkedin: "LinkedIn", meeting: "Meeting", note: "Note", facebook: "Facebook" };
const MAX_ENTRIES = 150;
const human = (s) => String(s || "").replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** GET /hq/week/history?range=last_week|last_4_weeks|this_month|last_month|custom&from=&to= */
exports.getHistory = async (req, res, next) => {
  try {
    const { scoreboard, ensureSeeded } = require("./hqPlaybookController");
    await ensureSeeded();
    const r = history.rangeFor(String(req.query.range || "last_week"), { from: req.query.from, to: req.query.to });
    const inRange = { $gte: r.start, $lt: r.end };
    const [plays, acts, content, signups] = await Promise.all([
      HqPlaybookPlay.find({}).sort({ order: 1, createdAt: 1 }).lean(),
      HqActivity.find({ at: inRange }).select("playId facilityId contactId fbGroupId fbPersonId fbAction kind outcome notes at count step").sort({ at: -1 }).lean(),
      HqContentItem.find({ status: "published", publishedAt: inRange }).select("title playId publishedAt url channel").lean(),
      Tenant.countDocuments({ createdAt: inRange }),
    ]);
    const board = new Map((await scoreboard(plays, [{ start: r.start, end: r.end }])).map((s) => [s.playId, s.weeks[0]]));

    // Names for the log.
    const ids = (k) => [...new Set(acts.map((a) => a[k]).filter(Boolean).map(String))];
    const [facs, cons, groups, people] = await Promise.all([
      HqFacility.find({ _id: { $in: ids("facilityId") } }).select("name city state").lean(),
      HqContact.find({ _id: { $in: ids("contactId") } }).select("name title").lean(),
      HqFbGroup.find({ _id: { $in: ids("fbGroupId") } }).select("name").lean(),
      HqFbPerson.find({ _id: { $in: ids("fbPersonId") } }).select("name").lean(),
    ]);
    const byId = (list) => new Map(list.map((x) => [String(x._id), x]));
    const [F, C, G, P] = [byId(facs), byId(cons), byId(groups), byId(people)];
    const who = (a) => {
      const c = a.contactId && C.get(String(a.contactId));
      const f = a.facilityId && F.get(String(a.facilityId));
      const g = a.fbGroupId && G.get(String(a.fbGroupId));
      const p = a.fbPersonId && P.get(String(a.fbPersonId));
      const person = c ? [c.name, c.title].filter(Boolean).join(", ") : "";
      const place = f ? `${f.name}${f.city ? ` (${f.city}${f.state ? `, ${f.state}` : ""})` : ""}` : "";
      return [person, place, g?.name, p?.name].filter(Boolean).join(" · ") || (a.count > 1 ? `${a.count} at once (a batch)` : "");
    };
    const entry = (a) => ({
      at: a.at,
      kind: KIND[a.kind] || "Touch",
      who: who(a),
      outcome: plan.OUTCOMES[a.outcome] || (a.fbAction ? human(a.fbAction) : a.kind === "email" ? `Email ${a.step || 1} sent` : ""),
      notes: a.notes ? String(a.notes).slice(0, 240) : "",
      count: a.count || 1,
    });

    // Blog posts count toward the blog campaign when that's switched on (see the blog PR); list them too.
    const blogPlay = plays.find((p) => p.seedKey === "search-templates");
    const blogPosts = blogPlay && typeof require("./hqController").blogPosts === "function" ? await require("./hqController").blogPosts().catch(() => []) : [];
    const posts = blogPosts.filter((p) => {
      const d = new Date(p.publishDate || 0);
      return d >= r.start && d < r.end;
    });

    const rows = plays.map((p) => {
      const id = String(p._id);
      const mine = acts.filter((a) => String(a.playId) === id);
      const pieces = content.filter((c) => String(c.playId) === id);
      const done = board.get(id) || 0;
      const target = p.active === false ? 0 : history.targetFor(p, r.days);
      const outcomes = history.tally(mine.filter((a) => a.kind === "call" || a.kind === "email").map((a) => plan.OUTCOMES[a.outcome] || (a.kind === "email" ? "Sent, no reply logged" : "")));
      const entries = [
        ...mine.map(entry),
        ...pieces.map((c) => ({ at: c.publishedAt, kind: "Published", who: c.title, outcome: "", notes: "", url: c.url || "" })),
        ...(blogPlay && id === String(blogPlay._id) ? posts.filter((x) => !pieces.some((c) => c.title === x.title)).map((x) => ({ at: x.publishDate, kind: "On the blog", who: x.title, outcome: "", notes: "", url: x.slug ? `https://wisershifts.com/blog/${x.slug}` : "" })) : []),
      ].sort((a, b) => new Date(b.at) - new Date(a.at));
      return {
        _id: id,
        title: p.title,
        channel: p.channel,
        active: p.active !== false,
        unit: p.targetUnit || "",
        done,
        target,
        outcomes,
        entries: entries.slice(0, MAX_ENTRIES),
        more: Math.max(0, entries.length - MAX_ENTRIES),
      };
    });
    // Touches logged outside any campaign still happened.
    const loose = acts.filter((a) => !a.playId);
    if (loose.length) {
      rows.push({ _id: "other", title: "Not in a campaign", channel: "other", active: true, unit: "touches", done: loose.reduce((n, a) => n + (a.count || 1), 0), target: 0, outcomes: [], entries: loose.slice(0, MAX_ENTRIES).map(entry), more: Math.max(0, loose.length - MAX_ENTRIES) });
    }

    const sum = (kind) => acts.filter((a) => a.kind === kind).reduce((n, a) => n + (a.count || 1), 0);
    res.json({
      range: { key: r.key, label: r.label, span: r.span, start: r.start, end: r.end, days: r.days },
      ranges: history.RANGES,
      totals: {
        calls: sum("call"),
        emails: sum("email"),
        facebook: sum("facebook"),
        published: content.length + posts.filter((x) => !content.some((c) => c.title === x.title)).length,
        booked: acts.filter((a) => a.outcome === "booked").length,
        replies: acts.filter((a) => a.outcome === "replied").length,
        signups,
      },
      plays: rows.filter((x) => x.done || x.target || x.entries.length),
    });
  } catch (err) {
    next(err);
  }
};
