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
const HqContentItem = require("../models/hqContentItemModel");
const HqFacility = require("../models/hqFacilityModel");
const HqContact = require("../models/hqContactModel");
const HqFbGroup = require("../models/hqFbGroupModel");
const HqFbPerson = require("../models/hqFbPersonModel");
const { lastWeeks } = require("../utils/hq/weeks");
const plan = require("../utils/hq/weekPlan");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const by = (req) => req.hqUser?.name || req.hqUser?.email || "";
const fail = (res, status, message) => res.status(status).json({ message });

async function context(now) {
  const { scoreboard, ensureSeeded } = require("./hqPlaybookController");
  const { lastTouchMap } = require("./hqController");
  await ensureSeeded();
  const week = lastWeeks(1, now)[0];
  const [plays, items, facilities, contacts, lastTouch, groups, people] = await Promise.all([
    HqPlaybookPlay.find({ active: true }).sort({ order: 1, createdAt: 1 }).lean(),
    HqContentItem.find({}).select("title status playId publishedAt dueDate channel format audience url notes owner").lean(),
    HqFacility.find({}).select("name city state tier stage nextDate nextStep lastCallDate frontDeskPhone scheduler tenantId").lean(),
    HqContact.find({}).select("name title role email phone linkedin facilityId facilityName group").lean(),
    lastTouchMap(),
    HqFbGroup.find({}).lean(),
    HqFbPerson.find({}).lean(),
  ]);
  const counts = new Map((await scoreboard(plays, [week])).map((s) => [s.playId, s.weeks[0]]));
  return { week, plays, items, facilities, contacts, lastTouch, groups, people, counts, now };
}

/** Add to-dos so every play's list reaches its target. Returns how many were added. */
function fill(doc, ctx, only = null) {
  const removed = new Set(doc.removed || []);
  // Someone on one play's list this week isn't put on another's.
  const taken = new Set(doc.items.filter((t) => t.refId).map((t) => String(t.refId)));
  let added = 0;
  for (const p of ctx.plays) {
    if (only && plan.listKind(p) !== only) continue;
    const have = doc.items.filter((t) => String(t.playId) === String(p._id) && t.kind !== "task");
    const todos = plan.todosFor(p, { ...ctx, weekStart: ctx.week.start, weekEnd: ctx.week.end, have, removed, taken });
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
    .select("playId facilityId contactId at fbGroupId fbPersonId fbAction")
    .lean();
  const actIds = new Set((await HqActivity.find({ _id: { $in: doc.items.filter((t) => t.activityId).map((t) => t.activityId) } }).select("_id").lean()).map((a) => String(a._id)));
  const loggedFor = (t) =>
    t.kind === "fbgroup" || t.kind === "fbperson"
      ? acts.find((a) => a.fbAction === t.action && String(t.kind === "fbgroup" ? a.fbGroupId : a.fbPersonId) === String(t.refId))
      : acts.find((a) => String(a.playId) === String(t.playId) && (t.kind === "contact" ? String(a.contactId) === String(t.refId) : String(a.facilityId) === String(t.refId)));

  const todo = (t) => {
    const base = { _id: String(t._id), playId: t.playId ? String(t.playId) : null, kind: t.kind, refId: t.refId ? String(t.refId) : null, facilityId: t.facilityId ? String(t.facilityId) : null, title: t.title, detail: t.detail, phone: t.phone, email: t.email, day: t.day, added: t.added, action: t.action || "", url: t.url || "" };
    if (t.kind === "content") {
      const i = itemById.get(String(t.refId));
      if (!i) return null; // the piece was deleted
      const done = i.status === "published";
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
        doneAt: done ? i.publishedAt : null,
        canUndo: done && Boolean(t.prevStatus),
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
    return { ...base, done: Boolean(mine || other), doneAt: mine ? t.doneAt : other ? other.at : null, canUndo: Boolean(mine) };
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
        todos,
        short: short ? { ...short, onList: todos.length, target } : null,
        more: plan.moreFor(p, { ...ctx, weekEnd: ctx.week.end, have, removed, taken }).map((m) => ({ ...m, playId: String(p._id) })),
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
    // New Facebook groups and people to message join the week on their own.
    if (fill(doc, ctx, "facebook")) await doc.save();
    res.json(await view(doc, ctx));
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
    const a = await HqActivity.create({ facilityId, contactId: t.kind === "contact" ? t.refId : null, kind, playId: t.playId, at: now, by: by(req), notes: String(req.body?.notes || "").slice(0, 4000), outcome: String(req.body?.outcome || "").slice(0, 200) });
    t.activityId = a._id;
    t.doneAt = now;
    if (facilityId && kind === "call") {
      const f = await HqFacility.findById(facilityId).select("lastCallDate").lean();
      t.prevLastCall = f?.lastCallDate || null;
      await HqFacility.updateOne({ _id: facilityId }, { $set: { lastCallDate: now }, $inc: { attempts: 1 } });
    }
  } else if (!done) {
    if (!t.activityId) return "This was logged somewhere else. Remove it from the history there.";
    const a = await HqActivity.findByIdAndDelete(t.activityId).lean();
    if (a?.facilityId && a.kind === "call") await HqFacility.updateOne({ _id: a.facilityId }, { $set: { lastCallDate: t.prevLastCall || null }, $inc: { attempts: -1 } });
    t.activityId = null;
    t.doneAt = null;
    t.prevLastCall = null;
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
  if (fill(doc, ctx, "facebook")) await doc.save();
};
