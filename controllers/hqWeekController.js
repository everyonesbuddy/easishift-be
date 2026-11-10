/**
 * HQ "This week": a specific checklist for every running play's weekly
 * target. Ticking a call or email logs it (with the play, so the scoreboard
 * counts it); ticking a content piece marks it published. Unticking undoes
 * that. Anything beyond the list (the next people, later content) can be
 * ticked too and joins the list.
 */
const mongoose = require("mongoose");
const HqWeekPlan = require("../models/hqWeekPlanModel");
const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
const HqActivity = require("../models/hqActivityModel");
const { knownFor } = require("../utils/hq/callContext");
const blog = require("../utils/hq/blog");
const HqContentItem = require("../models/hqContentItemModel");
const HqFacility = require("../models/hqFacilityModel");
const HqContact = require("../models/hqContactModel");
const HqFbGroup = require("../models/hqFbGroupModel");
const HqFbPerson = require("../models/hqFbPersonModel");
const { lastWeeks, dayToDate } = require("../utils/hq/weeks");
const plan = require("../utils/hq/weekPlan");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const by = (req) => req.hqUser?.name || req.hqUser?.email || "";
const fail = (res, status, message) => res.status(status).json({ message });

async function context(now) {
  const { scoreboard, ensureSeeded } = require("./hqPlaybookController");
  const { lastTouchMap, blogPosts } = require("./hqController");
  await ensureSeeded();
  const week = lastWeeks(1, now)[0];
  const [plays, items, facilities, contacts, lastTouch, groups, people] = await Promise.all([
    HqPlaybookPlay.find({ active: true }).sort({ order: 1, createdAt: 1 }).lean(),
    HqContentItem.find({}).select("title status playId publishedAt dueDate channel format audience url notes owner").lean(),
    HqFacility.find({}).select("name city state tier stage nextDate nextStep lastCallDate frontDeskPhone scheduler tenantId").lean(),
    HqContact.find({ leftAt: null }).select("name title role email phone linkedin facilityId facilityName group").lean(), // people who left are off every list
    lastTouchMap(),
    HqFbGroup.find({}).lean(),
    HqFbPerson.find({}).lean(),
  ]);
  // A play due every N weeks counts its last N weeks (1 every 2 weeks: a post last week covers this week too).
  const posts = plays.some(blog.isBlogPlay) ? await blogPosts().catch(() => []) : [];
  const spanOf = (p) => (p.weeklyTarget > 0 && p.weeklyTarget < 1 ? Math.min(4, Math.round(1 / p.weeklyTarget)) : 1);
  const recent = lastWeeks(4, now);
  const board = await scoreboard(plays, recent, { blogPosts: posts });
  const counts = new Map(board.map((s) => {
    const p = plays.find((x) => String(x._id) === s.playId);
    return [s.playId, s.weeks.slice(-spanOf(p)).reduce((a, b) => a + b, 0)];
  }));
  // Calls and emails from the last six months: what happened decides the follow-ups, and who's done.
  const peoplePlays = plays.filter((p) => plan.listKind(p) === "people").map((p) => p._id);
  const acts = await HqActivity.find({ at: { $gte: new Date(now - 180 * 86400000) }, $or: [{ playId: { $in: peoplePlays } }, { outcome: { $in: [...plan.STOP] } }] })
    .select("playId facilityId contactId at kind step outcome nextDate notes")
    .lean();
  return { week, plays, items, facilities, contacts, lastTouch, groups, people, counts, now, acts, stopped: plan.stoppedIds(acts, now), posts, spanOf, recent };
}

/** Add to-dos so every play's list reaches its target. Returns how many were added. */
function fill(doc, ctx, only = null) {
  const removed = new Set(doc.removed || []);
  // Someone on one play's list this week isn't put on another's; anyone who replied, booked or said no isn't put on any.
  const taken = new Set([...doc.items.filter((t) => t.refId).map((t) => String(t.refId)), ...(ctx.stopped || [])]);
  let added = 0;
  for (const p of ctx.plays) {
    const kind = plan.listKind(p);
    const have = doc.items.filter((t) => String(t.playId) === String(p._id) && t.kind !== "task");
    // Follow-ups (email 2 and 3, call-backs, another try) are owed, so they're added whenever they come due.
    if (kind === "people" && (!only || only === "followups")) {
      for (const t of plan.followUpTodos(p, { ...ctx, weekStart: ctx.week.start, weekEnd: ctx.week.end, have })) {
        doc.items.push({ ...t, playId: p._id });
        added += 1;
      }
    }
    if (only && only !== kind) continue;
    const todos = plan.todosFor(p, { ...ctx, weekStart: ctx.week.start, weekEnd: ctx.week.end, have: have.filter((t) => !t.fkey), removed, taken });
    for (const t of todos) {
      doc.items.push({ ...t, playId: p._id });
      taken.add(String(t.refId));
      added += 1;
    }
  }
  return added;
}

async function loadWeek(ctx) {
  let doc = await HqWeekPlan.findOne({ weekKey: ctx.week.key });
  if (!doc) {
    doc = new HqWeekPlan({ weekKey: ctx.week.key, items: [] });
    fill(doc, ctx);
    try {
      await doc.save();
    } catch (err) {
      if (err?.code !== 11000) throw err;
      doc = await HqWeekPlan.findOne({ weekKey: ctx.week.key }); // made at the same moment elsewhere
    }
  }
  return doc;
}

/** The week as the page shows it: each play with its target, progress, list and "more". */
async function view(doc, ctx) {
  const blogId = (ctx.plays.find(blog.isBlogPlay) || {})._id; // the blog campaign: pieces already on the blog show as done
  const itemById = new Map(ctx.items.map((i) => [String(i._id), i]));
  const contactById = new Map(ctx.contacts.map((c) => [String(c._id), c]));
  const weekEnd = new Date(ctx.week.end);
  // A piece's day: its due date if that's this week, otherwise spread over the week.
  const dueDay = (d) => {
    if (!d) return null;
    const t = new Date(d);
    if (t < new Date(ctx.week.start) || t >= weekEnd) return null;
    return Math.min(6, Math.floor((t - new Date(ctx.week.start)) / 86400000));
  };
  const acts = await HqActivity.find({ playId: { $in: ctx.plays.map((p) => p._id) }, at: { $gte: ctx.week.start, $lt: ctx.week.end } })
    .select("playId facilityId contactId at fbGroupId fbPersonId fbAction step outcome")
    .lean();
  const actById = new Map((await HqActivity.find({ _id: { $in: doc.items.filter((t) => t.activityId).map((t) => t.activityId) } }).select("_id outcome nextDate").lean()).map((a) => [String(a._id), a]));
  const actIds = new Set(actById.keys());
  const loggedFor = (t) =>
    t.kind === "fbgroup" || t.kind === "fbperson"
      ? acts.find((a) => a.fbAction === t.action && String(t.kind === "fbgroup" ? a.fbGroupId : a.fbPersonId) === String(t.refId))
      : acts.find(
          (a) =>
            String(a.playId) === String(t.playId) &&
            (t.kind === "contact" ? String(a.contactId) === String(t.refId) : String(a.facilityId) === String(t.refId)) &&
            // A follow-up is done by a later touch (for email, the right one in the sequence), not the one before it.
            (!t.fkey || (new Date(a.at) > t._id.getTimestamp() && (!t.step || (a.step || 1) === t.step))),
        );

  // What HQ knows about each person or building on the list (stage, scheduler, last touches).
  const facById = new Map(ctx.facilities.map((f) => [String(f._id), f]));
  const peopleTodos = doc.items.filter((t) => t.kind === "facility" || t.kind === "contact");
  const facIds = [...new Set(peopleTodos.map((t) => t.facilityId).filter(Boolean).map(String))];
  const conIds = [...new Set(peopleTodos.filter((t) => t.kind === "contact").map((t) => String(t.refId)))];
  const history = facIds.length || conIds.length
    ? await HqActivity.find({ $or: [{ facilityId: { $in: facIds } }, { contactId: { $in: conIds } }] }).select("facilityId contactId playId kind outcome notes at").lean()
    : [];
  history.sort((a, b) => new Date(b.at) - new Date(a.at));
  const playById = new Map(ctx.plays.map((p) => [String(p._id), p]));
  const knownOf = (t) => {
    const facility = t.facilityId ? facById.get(String(t.facilityId)) || null : null;
    const contact = t.kind === "contact" ? contactById.get(String(t.refId)) || null : null;
    const acts = history.filter((a) => (t.kind === "contact" ? String(a.contactId) === String(t.refId) || (facility && String(a.facilityId) === String(facility._id) && !a.contactId) : facility && String(a.facilityId) === String(facility._id)));
    // For a leader, the building's scheduler calls count too (that's how you'd know you spoke with their scheduler).
    const building = facility ? history.filter((a) => String(a.facilityId) === String(facility._id)) : [];
    return knownFor(t, { facility, contact, acts, buildingActs: building, plays: playById });
  };

  const todo = (t) => {
    const base = { _id: String(t._id), playId: t.playId ? String(t.playId) : null, kind: t.kind, refId: t.refId ? String(t.refId) : null, facilityId: t.facilityId ? String(t.facilityId) : null, title: t.title, detail: t.detail, phone: t.phone, email: t.email, day: t.day, added: t.added, action: t.action || "", step: t.step || null, reason: t.reason || "", fkey: t.fkey || "", known: t.kind === "facility" || t.kind === "contact" ? knownOf(t) : null, url: t.kind === "fbgroup" || t.kind === "fbperson" ? require("../utils/hq/facebook").fullUrl(t.url) : t.url || "" };
    if (t.kind === "content") {
      const i = itemById.get(String(t.refId));
      if (!i) return null; // the piece was deleted
      // A piece already published on the blog (same title) is done, even if it was never ticked here.
      const post = String(i.playId) === String(blogId) && i.status !== "published" ? (ctx.posts || []).find((x) => blog.sameTitle(x.title, i.title)) : null;
      const done = i.status === "published" || Boolean(post);
      return {
        ...base,
        title: i.title,
        status: i.status,
        url: i.url || "",
        channel: i.channel,
        format: i.format,
        dueDate: i.dueDate || null,
        notes: i.notes || "",
        owner: i.owner || "",
        audience: i.audience || [],
        itemPlayId: i.playId ? String(i.playId) : null,
        day: t.day ?? dueDay(i.dueDate),
        done,
        doneAt: post ? blog.postDate(post) : done ? i.publishedAt : null,
        canUndo: !post && done && Boolean(t.prevStatus),
        ...(post ? { onBlog: blog.postUrl(post) } : {}),
      };
    }
    if (t.kind === "task") return { ...base, done: t.done, doneAt: t.doneAt, canUndo: true };
    if (t.kind === "contact") {
      const c = contactById.get(String(t.refId));
      base.firstName = c?.firstName || String(c?.name || "").trim().split(/\s+/)[0] || "";
      base.who = c ? [c.name, c.title].filter(Boolean).join(", ") : "";
    }
    const mine = t.activityId && actIds.has(String(t.activityId));
    const other = !mine && loggedFor(t);
    const outcome = mine ? actById.get(String(t.activityId))?.outcome || "" : other?.outcome || "";
    const nextDate = mine ? actById.get(String(t.activityId))?.nextDate || null : null;
    return { ...base, done: Boolean(mine || other), doneAt: mine ? t.doneAt : other ? other.at : null, canUndo: Boolean(mine), outcome, outcomeLabel: plan.OUTCOMES[outcome] || "", nextDate };
  };

  const removed = new Set(doc.removed || []);
  const taken = new Set(doc.items.filter((t) => t.refId).map((t) => String(t.refId)));
  const plays = ctx.plays
    .filter((p) => plan.listKind(p))
    .map((p) => {
      const have = doc.items.filter((t) => String(t.playId) === String(p._id));
      const todos = have.map(todo).filter(Boolean);
      // Content without a day this week gets one, spread over Monday to Friday.
      if (plan.listKind(p) === "content") {
        const free = todos.filter((t) => t.day === null || t.day === undefined);
        free.forEach((t, i) => (t.day = plan.contentDay(i, free.length)));
      }
      const target = plan.weeklyCount(p);
      const span = ctx.spanOf ? ctx.spanOf(p) : 1;
      // The blog campaign shows what went out on the blog in its window, and drops ideas that already did.
      const isBlog = blog.isBlogPlay(p);
      const windowFrom = ctx.recent ? ctx.recent[ctx.recent.length - span].start : ctx.week.start;
      // What went out in the window that isn't a row on the list: blog posts, and pieces published
      // from the calendar (so "logged another way" never leaves you guessing what it was).
      const listed = new Set(todos.filter((t) => t.kind === "content").map((t) => String(t.refId)));
      const pieces = plan.listKind(p) === "content"
        ? ctx.items
            .filter((i) => String(i.playId) === String(p._id) && i.status === "published" && i.publishedAt && new Date(i.publishedAt) >= windowFrom && new Date(i.publishedAt) < ctx.week.end && !listed.has(String(i._id)))
            .map((i) => ({ title: i.title, url: i.url || "", date: i.publishedAt, where: "Published" }))
        : [];
      const posts = isBlog ? blog.uncounted(blog.postsIn(ctx.posts, windowFrom, ctx.week.end), [...pieces, ...todos.filter((t) => t.kind === "content" && t.done)]).map((x) => ({ ...x, where: "On the blog" })) : [];
      const published = [...posts, ...pieces].sort((a, b) => new Date(b.date) - new Date(a.date));
      const short = plan.listKind(p) === "people" && todos.length < target ? plan.whyShort(p, ctx) : null;
      return {
        _id: String(p._id),
        title: p.title,
        channel: p.channel,
        audience: p.audience,
        weeklyTarget: p.weeklyTarget,
        targetUnit: p.targetUnit,
        countsFrom: p.countsFrom,
        list: plan.listKind(p),
        steps: p.steps || [],
        scripts: p.scripts || [],
        count: ctx.counts.get(String(p._id)) || 0,
        span,
        published,
        todos,
        short: short ? { ...short, onList: todos.length, target } : null,
        more: plan
          .moreFor(p, { ...ctx, weekEnd: ctx.week.end, have, removed, taken })
          .filter((m) => !(isBlog && (ctx.posts || []).some((x) => blog.sameTitle(x.title, m.title))))
          .map((m) => ({ ...m, playId: String(p._id) })),
      };
    });
  const tz = require("../utils/hq/weeks").zone();
  const today = Math.max(0, Math.min(6, Math.floor((ctx.now - ctx.week.start) / 86400000)));
  return {
    weekKey: ctx.week.key,
    weekStart: ctx.week.start,
    weekEnd: ctx.week.end,
    timeZone: tz,
    today,
    plays,
    tasks: doc.items.filter((t) => t.kind === "task" && !t.playId).map(todo),
  };
}

exports.getWeek = async (req, res, next) => {
  try {
    const ctx = await context(new Date());
    const doc = await loadWeek(ctx);
    // New Facebook groups and people to message, and follow-ups as they come due, join the week on their own.
    if (fill(doc, ctx, "facebook") + fill(doc, ctx, "followups")) await doc.save();
    // Government contract deadlines (questions and responses due soon), worked out fresh each time.
    const zone = require("../utils/hq/weeks").zone();
    const [gov, success] = await Promise.all([require("./hqGovController").deadlines(ctx.now, zone), require("./hqSuccessController").todos(ctx.now, zone)]);
    res.json({ ...(await view(doc, ctx)), gov, success });
  } catch (err) {
    next(err);
  }
};

/** Top the list up (new facilities, new content, or after removing some). */
exports.refill = async (req, res, next) => {
  try {
    const ctx = await context(new Date());
    const doc = await loadWeek(ctx);
    const added = fill(doc, ctx);
    if (added) await doc.save();
    res.json({ added, ...(await view(doc, ctx)) });
  } catch (err) {
    next(err);
  }
};

/** Tick or untick: log / unlog the touch, publish / unpublish the piece. */
/**
 * "Who replaced them?" from the request: name, title, phone, email. With no
 * name, keepCalling (on unless false) still adds whoever has the job now,
 * by title, on the same number: the front desk line works, the person moved on.
 */
function replacementFrom(body) {
  const r = body?.replacement || {};
  const clip = (v, n = 120) => String(v || "").trim().slice(0, n);
  const out = { name: clip(r.name), title: clip(r.title), phone: clip(r.phone, 40), email: clip(r.email, 200).toLowerCase() };
  if (out.name) return out;
  return body?.keepCalling === false ? null : { ...out, unnamed: true };
}

/**
 * "No longer works there". A person: off every list for good, and whoever
 * replaced them becomes a new contact at the same building. The front desk
 * call: the scheduler you had saved is cleared (or replaced) and the building
 * stays on the list. Remembers what it changed on the to-do, for undo.
 */
async function personLeft(t, replacement, now) {
  const note = (who) => `Replaced ${who || "someone"}, who no longer works there (logged ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })}).`;
  if (t.kind === "contact") {
    const c = await HqContact.findById(t.refId).lean();
    if (!c) return "";
    t.prevLeft = { leftAt: c.leftAt || null, replacedBy: c.replacedBy || null };
    let replacedBy = null;
    if (replacement) {
      // The number you called still works (it's usually the front desk), so it carries over unless you gave a new one.
      const { unnamed, ...r } = replacement;
      const title = r.title || c.title || "";
      const n = await HqContact.create({
        ...r,
        title,
        phone: r.phone || c.phone || "",
        role: c.role,
        facilityId: c.facilityId,
        facilityName: c.facilityName,
        group: c.group,
        source: "manual",
        notes: unnamed ? `Whoever has the job now: ask the front desk for the ${title || "person in this role"}. ${note(c.name)}` : note(c.name),
      });
      replacedBy = n._id;
    }
    await HqContact.updateOne({ _id: c._id }, { $set: { leftAt: now, replacedBy } });
    if (!replacement) return "";
    return replacement.unnamed ? `Name of who replaced them not known yet; still calling for the ${replacement.title || c.title || "same role"}.` : `Replaced by ${replacement.name}${replacement.title ? `, ${replacement.title}` : ""}.`;
  }
  if (t.kind === "facility") {
    const f = await HqFacility.findById(t.refId).select("scheduler").lean();
    if (!f) return "";
    const old = f.scheduler || {};
    t.prevLeft = { scheduler: old };
    const named = replacement && !replacement.unnamed;
    await HqFacility.updateOne({ _id: f._id }, { $set: { scheduler: named ? { name: replacement.name, title: replacement.title, phone: replacement.phone, email: replacement.email } : { name: "", title: "", phone: "", email: "" } } });
    return `${old.name ? `${old.name} no longer works there.` : "The scheduler no longer works there."}${named ? ` New scheduler: ${replacement.name}.` : ""}`;
  }
  return "";
}

/** Undo "no longer works there": the person is back on the lists, or the old scheduler is restored. A replacement contact stays. */
async function undoLeft(t) {
  if (!t.prevLeft) return;
  if (t.kind === "contact") await HqContact.updateOne({ _id: t.refId }, { $set: { leftAt: t.prevLeft.leftAt || null, replacedBy: t.prevLeft.replacedBy || null } });
  if (t.kind === "facility" && t.prevLeft.scheduler) await HqFacility.updateOne({ _id: t.refId }, { $set: { scheduler: t.prevLeft.scheduler } });
  t.prevLeft = null;
}

async function setDone(t, done, req) {
  const now = new Date();
  if (t.kind === "task") {
    t.done = done;
    t.doneAt = done ? now : null;
    return null;
  }
  if (t.kind === "content") {
    const i = await HqContentItem.findById(t.refId);
    if (!i) return "That content piece was deleted.";
    if (done && i.status !== "published") {
      t.prevStatus = i.status;
      i.status = "published";
      i.publishedAt = now;
      await i.save();
    } else if (!done && i.status === "published") {
      if (!t.prevStatus) return "This was published before it was ticked here. Change it on the content board.";
      i.status = t.prevStatus;
      i.publishedAt = null;
      await i.save();
      t.prevStatus = "";
    }
    t.doneAt = done ? now : null;
    return null;
  }
  if (t.kind === "fbgroup" || t.kind === "fbperson") {
    const fbc = require("./hqFacebookController");
    if (done && !t.activityId) {
      const r = await fbc.logAction(t.kind === "fbgroup" ? "group" : "person", t.refId, t.action, { req, notes: req.body?.notes, playId: t.playId || null });
      if (r.error) return r.error;
      t.activityId = r.activity._id;
      t.doneAt = new Date();
    } else if (!done) {
      if (!t.activityId) return "This was logged on the Facebook page. Undo it there.";
      await fbc.undoAction(t.activityId);
      t.activityId = null;
      t.doneAt = null;
    }
    return null;
  }
  const play = t.playId ? await HqPlaybookPlay.findById(t.playId).select("channel").lean() : null;
  const kind = plan.TOUCH[play?.channel] || "note";
  if (done && !t.activityId) {
    const contact = t.kind === "contact" ? await HqContact.findById(t.refId).select("facilityId").lean() : null;
    const facilityId = t.kind === "facility" ? t.refId : contact?.facilityId || null;
    // What happened on the call (booked, call back, voicemail…) decides what comes next.
    const outcome = kind === "call" && plan.OUTCOMES[req.body?.outcome] ? req.body.outcome : kind === "call" ? "reached" : "";
    const nextDate = outcome === "callback" ? dayToDate(req.body?.nextDate) || new Date(now.getTime() + 2 * 86400000) : null;
    const leftNote = outcome === "left" ? await personLeft(t, replacementFrom(req.body), now) : "";
    const a = await HqActivity.create({
      facilityId,
      contactId: t.kind === "contact" ? t.refId : null,
      kind,
      playId: t.playId,
      at: now,
      by: by(req),
      notes: [String(req.body?.notes || "").trim(), leftNote].filter(Boolean).join(" ").slice(0, 4000),
      outcome,
      nextDate,
      step: kind === "email" ? t.step || 1 : null,
    });
    t.activityId = a._id;
    t.doneAt = now;
    if (facilityId && kind === "call" && t.kind === "facility") {
      const f = await HqFacility.findById(facilityId).select("lastCallDate nextDate nextStep stage").lean();
      t.prevLastCall = f?.lastCallDate || null;
      t.prevFacility = { nextDate: f?.nextDate || null, nextStep: f?.nextStep || "", stage: f?.stage || "" };
      const set = { lastCallDate: now };
      if (outcome === "callback") Object.assign(set, { nextDate, nextStep: "Call back" });
      else if (f?.nextDate && new Date(f.nextDate) <= new Date(now.getTime() + 86400000)) Object.assign(set, { nextDate: null, nextStep: "" }); // the call-back happened
      if (outcome === "booked") Object.assign(set, { stage: "Setup booked", nextStep: "Free setup booked" });
      if (outcome === "not_interested") set.stage = "Not interested";
      if (outcome === "wrong_number") set.stage = "Wrong number";
      await HqFacility.updateOne({ _id: facilityId }, { $set: set, $inc: { attempts: 1 } });
    }
  } else if (!done) {
    if (!t.activityId) return "This was logged somewhere else. Remove it from the history there.";
    const a = await HqActivity.findByIdAndDelete(t.activityId).lean();
    if (a?.outcome === "left") await undoLeft(t);
    if (a?.facilityId && a.kind === "call" && t.kind === "facility") {
      await HqFacility.updateOne({ _id: a.facilityId }, { $set: { lastCallDate: t.prevLastCall || null, ...(t.prevFacility || {}) }, $inc: { attempts: -1 } });
    }
    t.activityId = null;
    t.doneAt = null;
    t.prevLastCall = null;
    t.prevFacility = null;
  }
  return null;
}

exports.check = async (req, res, next) => {
  try {
    const ctx = await context(new Date());
    const doc = await loadWeek(ctx);
    const done = req.body?.done !== false;
    let t = isId(req.params.itemId) ? doc.items.id(req.params.itemId) : null;
    if (!t) {
      // Something from "more": add it to the list, then tick it.
      const { playId, kind, refId, action } = req.body || {};
      if (!isId(playId) || !isId(refId) || !["facility", "contact", "content", "fbgroup"].includes(kind)) return fail(res, 404, "Not on this week's list");
      const p = ctx.plays.find((x) => String(x._id) === String(playId));
      if (!p) return fail(res, 400, "That play isn't running");
      const have = doc.items.filter((x) => String(x.playId) === String(playId));
      const found = plan.moreFor(p, { ...ctx, weekEnd: ctx.week.end, have, removed: new Set(), taken: new Set() }, 10000).find((m) => m.refId === String(refId) && m.kind === kind && (!action || m.action === action));
      if (!found) return fail(res, 400, "That one can't be added any more");
      doc.items.push({ ...found, playId: p._id, day: kind === "content" || kind === "fbgroup" ? null : ctx.now ? Math.min(6, Math.floor((ctx.now - ctx.week.start) / 86400000)) : null, added: true });
      doc.removed = (doc.removed || []).filter((r) => r !== String(refId));
      t = doc.items[doc.items.length - 1];
    }
    const problem = await setDone(t, done, req);
    if (problem) return fail(res, 409, problem);
    await doc.save();
    res.json(await view(doc, await context(new Date())));
  } catch (err) {
    next(err);
  }
};

/** Your own to-do for the week, with or without a play. */
exports.addTask = async (req, res, next) => {
  try {
    const title = String(req.body?.title || "").trim().slice(0, 300);
    if (!title) return fail(res, 400, "What's the to-do?");
    const ctx = await context(new Date());
    const doc = await loadWeek(ctx);
    const day = Number.isInteger(req.body?.day) && req.body.day >= 0 && req.body.day <= 6 ? req.body.day : null;
    doc.items.push({ kind: "task", title, playId: isId(req.body?.playId) ? req.body.playId : null, day, added: true });
    await doc.save();
    res.status(201).json(await view(doc, ctx));
  } catch (err) {
    next(err);
  }
};

/** Take something off the list (refills won't bring it back this week). Its logged touch, if any, is undone. */
exports.removeItem = async (req, res, next) => {
  try {
    const ctx = await context(new Date());
    const doc = await loadWeek(ctx);
    const t = isId(req.params.itemId) ? doc.items.id(req.params.itemId) : null;
    if (!t) return fail(res, 404, "Not on this week's list");
    if (t.activityId) {
      const problem = await setDone(t, false, req);
      if (problem) return fail(res, 409, problem);
    }
    if (t.refId) doc.removed = [...new Set([...(doc.removed || []), String(t.refId)])];
    t.deleteOne();
    await doc.save();
    res.json(await view(doc, ctx));
  } catch (err) {
    next(err);
  }
};

/** Top this week's list up (used after adding Facebook groups or people). */
module.exports.topUp = async () => {
  const ctx = await context(new Date());
  const doc = await loadWeek(ctx);
  if (fill(doc, ctx, "facebook") + fill(doc, ctx, "followups")) await doc.save();
};

/**
 * After an email: "They replied" or "Not interested" ends that person's
 * sequence (and takes them off cold lists). Empty puts it back.
 */
exports.setOutcome = async (req, res, next) => {
  try {
    const outcome = String(req.body?.outcome || "");
    if (outcome && !["replied", "not_interested", "booked", "left"].includes(outcome)) return fail(res, 400, "Which outcome?");
    const ctx = await context(new Date());
    const doc = await loadWeek(ctx);
    const t = isId(req.params.itemId) ? doc.items.id(req.params.itemId) : null;
    if (!t) return fail(res, 404, "Not on this week's list");
    if (!t.activityId) return fail(res, 409, "Tick it as sent first.");
    const was = (await HqActivity.findById(t.activityId).select("outcome notes").lean()) || {};
    const set = { outcome };
    if (was.outcome === "left" && outcome !== "left") await undoLeft(t);
    if (outcome === "left" && was.outcome !== "left") {
      const note = await personLeft(t, replacementFrom(req.body), new Date());
      if (note) set.notes = [was.notes, note].filter(Boolean).join(" ").slice(0, 4000);
    }
    await HqActivity.updateOne({ _id: t.activityId }, { $set: set });
    if (t.isModified?.("prevLeft") || outcome === "left" || was.outcome === "left") await doc.save();
    res.json(await view(doc, await context(new Date())));
  } catch (err) {
    next(err);
  }
};

exports._test = { personLeft, undoLeft, replacementFrom, view };
