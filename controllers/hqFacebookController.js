/**
 * HQ Facebook: the groups where our buyers talk (with where we stand in
 * each) and the people we message from them. Logging an action moves the
 * group or person to its next step and counts toward the Facebook groups
 * play; undoing it puts things back.
 */
const mongoose = require("mongoose");
const HqFbGroup = require("../models/hqFbGroupModel");
const HqFbPerson = require("../models/hqFbPersonModel");
const HqActivity = require("../models/hqActivityModel");
const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
const fb = require("../utils/hq/facebook");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const by = (req) => req.hqUser?.name || req.hqUser?.email || "";
const fail = (res, status, message) => res.status(status).json({ message });

const GROUP_FIELDS = ["name", "url", "audience", "members", "region", "allowsPages", "promo", "admin", "priority", "status", "rules", "notes"];
const PERSON_FIELDS = ["name", "profileUrl", "groupId", "postUrl", "said", "role", "facility", "status", "notes"];
const pick = (b, fields) => Object.fromEntries(fields.filter((f) => b?.[f] !== undefined).map((f) => [f, b[f]]));

function cleanGroup(b) {
  const out = pick(b, GROUP_FIELDS);
  if (out.members !== undefined) out.members = out.members === "" || out.members === null ? null : Math.max(0, Math.round(Number(String(out.members).replace(/[^\d.]/g, "")) || 0)) || null;
  if (out.priority !== undefined) out.priority = [1, 2, 3].includes(Number(out.priority)) ? Number(out.priority) : 2;
  if (out.audience !== undefined) out.audience = (Array.isArray(out.audience) ? out.audience : []).filter((a) => ["scheduler", "director", "operator"].includes(a));
  for (const k of ["name", "url", "region", "admin", "rules", "notes"]) if (out[k] !== undefined) out[k] = String(out[k] || "").slice(0, k === "notes" || k === "rules" ? 4000 : 400);
  if (out.url !== undefined) out.url = fb.fullUrl(out.url);
  return out;
}
function cleanPerson(b) {
  const out = pick(b, PERSON_FIELDS);
  if (out.groupId !== undefined) out.groupId = isId(out.groupId) ? out.groupId : null;
  for (const k of ["name", "profileUrl", "postUrl", "said", "role", "facility", "notes"]) if (out[k] !== undefined) out[k] = String(out[k] || "").slice(0, k === "notes" || k === "said" ? 4000 : 400);
  for (const k of ["profileUrl", "postUrl"]) if (out[k] !== undefined) out[k] = fb.fullUrl(out[k]);
  return out;
}

/** The play Facebook group touches count toward. */
async function fbPlay() {
  return (
    (await HqPlaybookPlay.findOne({ seedKey: "facebook-groups", active: true }).select("_id").lean()) ||
    (await HqPlaybookPlay.findOne({ channel: "facebook", countsFrom: "activities", active: true }).select("_id").lean())
  );
}

/**
 * Log an action on a group ("group") or person ("person"): moves it to its
 * next step and records a touch. Returns the activity, or an error message.
 */
async function logAction(type, id, action, { req = null, notes = "", playId, now = new Date() } = {}) {
  const Model = type === "group" ? HqFbGroup : HqFbPerson;
  const change = type === "group" ? fb.groupChange(action, now) : fb.personChange(action, now);
  if (!change) return { error: "Which action?" };
  const doc = isId(id) ? await Model.findById(id).lean() : null;
  if (!doc) return { error: type === "group" ? "That group is gone" : "That person is gone" };
  const prev = Object.fromEntries(Object.keys(change).map((k) => [k, doc[k] ?? null]));
  await Model.updateOne({ _id: doc._id }, { $set: change });
  const play = playId === undefined ? await fbPlay() : playId ? { _id: playId } : null;
  const activity = await HqActivity.create({
    kind: "facebook",
    fbGroupId: type === "group" ? doc._id : doc.groupId || null,
    fbPersonId: type === "person" ? doc._id : null,
    fbAction: action,
    fbPrev: { type, prev },
    playId: play?._id || null,
    notes: String(notes || "").slice(0, 4000),
    at: now,
    by: req ? by(req) : "",
  });
  return { activity };
}

/** Undo a logged Facebook action: remove the touch and put the group or person back. */
async function undoAction(activityId) {
  const a = isId(activityId) ? await HqActivity.findById(activityId).lean() : null;
  if (!a) return false;
  await HqActivity.deleteOne({ _id: a._id });
  const p = a.fbPrev;
  if (p?.prev) {
    if (p.type === "group" && a.fbGroupId) await HqFbGroup.updateOne({ _id: a.fbGroupId }, { $set: p.prev });
    if (p.type === "person" && a.fbPersonId) await HqFbPerson.updateOne({ _id: a.fbPersonId }, { $set: p.prev });
  }
  return true;
}

async function topUpWeek() {
  try {
    await require("./hqWeekController").topUp();
  } catch {
    // the week list catches up next time it's opened
  }
}

exports.getAll = async (req, res, next) => {
  try {
    const now = new Date();
    const [groups, people, touches] = await Promise.all([
      HqFbGroup.find({}).sort({ priority: 1, members: -1, name: 1 }).lean(),
      HqFbPerson.find({}).sort({ createdAt: -1 }).lean(),
      HqActivity.aggregate([{ $match: { kind: "facebook", fbGroupId: { $type: "objectId" } } }, { $group: { _id: "$fbGroupId", n: { $sum: 1 }, last: { $max: "$at" } } }]),
    ]);
    const t = new Map(touches.map((x) => [String(x._id), x]));
    const gName = new Map(groups.map((g) => [String(g._id), g.name]));
    const outGroups = groups.map((g) => ({ ...g, url: fb.fullUrl(g.url), next: fb.nextGroupStep(g, now), touches: t.get(String(g._id))?.n || 0, lastTouchAt: t.get(String(g._id))?.last || g.lastTouchAt || null }));
    const outPeople = people.map((p) => ({ ...p, profileUrl: fb.fullUrl(p.profileUrl), postUrl: fb.fullUrl(p.postUrl), groupName: gName.get(String(p.groupId)) || "", next: fb.nextPersonStep({ ...p, groupName: gName.get(String(p.groupId)) || "" }, now) }));
    const count = (list, k, v) => list.filter((x) => x[k] === v).length;
    res.json({
      groups: outGroups,
      people: outPeople,
      stats: {
        groups: groups.length,
        joined: groups.filter((g) => ["joined", "asked", "approved", "declined"].includes(g.status)).length,
        approved: count(groups, "status", "approved") + groups.filter((g) => g.promo === "allowed" || g.promo === "thread").filter((g) => g.status !== "approved").length,
        offers: groups.filter((g) => g.offerAt).length,
        reach: groups.filter((g) => ["joined", "asked", "approved", "declined"].includes(g.status)).reduce((s, g) => s + (g.members || 0), 0),
        people: people.length,
        toMessage: count(people, "status", "to_message"),
        replied: people.filter((p) => ["replied", "call_booked", "signed_up"].includes(p.status)).length,
        calls: people.filter((p) => ["call_booked", "signed_up"].includes(p.status)).length,
        signups: count(people, "status", "signed_up"),
      },
      labels: { groupStatuses: fb.GROUP_STATUSES, promo: fb.PROMO, personStatuses: fb.PERSON_STATUSES, groupActions: fb.GROUP_ACTIONS, personActions: fb.PERSON_ACTIONS },
    });
  } catch (err) {
    next(err);
  }
};

exports.createGroup = async (req, res, next) => {
  try {
    const body = cleanGroup(req.body);
    if (!body.name) return fail(res, 400, "What's the group called?");
    const group = await HqFbGroup.create(body);
    await topUpWeek();
    res.status(201).json({ group });
  } catch (err) {
    next(err);
  }
};

exports.updateGroup = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, "Not found");
    const group = await HqFbGroup.findByIdAndUpdate(req.params.id, { $set: cleanGroup(req.body) }, { new: true, runValidators: true }).lean();
    if (!group) return fail(res, 404, "Not found");
    res.json({ group });
  } catch (err) {
    next(err);
  }
};

/** Remove a group (its history stays, unlinked; people from it stay too). */
exports.deleteGroup = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, "Not found");
    const r = await HqFbGroup.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) return fail(res, 404, "Not found");
    await Promise.all([HqActivity.updateMany({ fbGroupId: req.params.id }, { $set: { fbGroupId: null } }), HqFbPerson.updateMany({ groupId: req.params.id }, { $set: { groupId: null } })]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.groupHistory = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, "Not found");
    const activities = await HqActivity.find({ fbGroupId: req.params.id }).sort({ at: -1 }).limit(200).lean();
    res.json({ activities });
  } catch (err) {
    next(err);
  }
};

const logRoute = (type) => async (req, res, next) => {
  try {
    const r = await logAction(type, req.params.id, String(req.body?.action || ""), { req, notes: req.body?.notes });
    if (r.error) return fail(res, 400, r.error);
    await topUpWeek();
    res.status(201).json({ activity: r.activity });
  } catch (err) {
    next(err);
  }
};
exports.logGroup = logRoute("group");
exports.logPerson = logRoute("person");

exports.undo = async (req, res, next) => {
  try {
    if (!(await undoAction(req.params.activityId))) return fail(res, 404, "Not found");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.createPerson = async (req, res, next) => {
  try {
    const body = cleanPerson(req.body);
    if (!body.name) return fail(res, 400, "What's their name?");
    const person = await HqFbPerson.create(body);
    await topUpWeek();
    res.status(201).json({ person });
  } catch (err) {
    next(err);
  }
};

exports.updatePerson = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, "Not found");
    const person = await HqFbPerson.findByIdAndUpdate(req.params.id, { $set: cleanPerson(req.body) }, { new: true, runValidators: true }).lean();
    if (!person) return fail(res, 404, "Not found");
    res.json({ person });
  } catch (err) {
    next(err);
  }
};

exports.deletePerson = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, "Not found");
    const r = await HqFbPerson.deleteOne({ _id: req.params.id });
    if (!r.deletedCount) return fail(res, 404, "Not found");
    await HqActivity.updateMany({ fbPersonId: req.params.id }, { $set: { fbPersonId: null } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

module.exports.logAction = logAction;
module.exports.undoAction = undoAction;
