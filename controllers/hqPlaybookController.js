/**
 * HQ playbook: the plays (by channel and buyer), the week plan, and the
 * scoreboard (this week vs target, counted from what's logged in HQ).
 */
const mongoose = require("mongoose");
const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
const HqContentItem = require("../models/hqContentItemModel");
const HqActivity = require("../models/hqActivityModel");
const HqLead = require("../models/hqLeadModel");
const HqSync = require("../models/hqSyncModel");
const Tenant = require("../models/tenantModel");
const seed = require("../utils/hq/playbookSeed");
const { lastWeeks } = require("../utils/hq/weeks");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const FIELDS = ["order", "title", "channel", "audience", "who", "goal", "when", "steps", "scripts", "volume", "weeklyTarget", "targetUnit", "countsFrom", "measure", "active"];
const pick = (b) => Object.fromEntries(FIELDS.filter((f) => b?.[f] !== undefined).map((f) => [f, b[f]]));

/** First visit: load the starting playbook and content ideas (only when empty). */
async function ensureSeeded() {
  if (await HqPlaybookPlay.exists({})) return;
  const created = new Map();
  for (const [i, p] of seed.PLAYS.entries()) {
    const doc = await HqPlaybookPlay.findOneAndUpdate({ seedKey: p.seedKey }, { $setOnInsert: { ...p, order: i } }, { upsert: true, new: true });
    created.set(p.seedKey, doc._id);
  }
  await HqSync.updateOne({ key: "playbook" }, { $setOnInsert: { data: seed.META } }, { upsert: true });
  if (!(await HqContentItem.exists({}))) {
    for (const [seedKey, title, format, channel, audience, play] of seed.CONTENT) {
      await HqContentItem.updateOne({ seedKey }, { $setOnInsert: { seedKey, title, format, channel, audience, status: "idea", playId: created.get(play) || null } }, { upsert: true });
    }
  }
}

/** Done per play per week, from activities / published content / leads / signups. */
async function scoreboard(plays, weeks) {
  const from = weeks[0].start;
  const to = weeks[weeks.length - 1].end;
  const ids = plays.map((p) => p._id);
  const [acts, content, leads, signups] = await Promise.all([
    HqActivity.find({ playId: { $in: ids }, at: { $gte: from, $lt: to } }).select("playId at").lean(),
    HqContentItem.find({ playId: { $in: ids }, status: "published", publishedAt: { $gte: from, $lt: to } }).select("playId publishedAt").lean(),
    HqLead.find({ createdAt: { $gte: from, $lt: to } }).select("createdAt").lean(),
    Tenant.find({ createdAt: { $gte: from, $lt: to } }).select("createdAt").lean(),
  ]);
  const weekOf = (d) => weeks.findIndex((w) => d >= w.start && d < w.end);
  return plays.map((p) => {
    const counts = weeks.map(() => 0);
    const add = (d) => {
      const i = weekOf(new Date(d));
      if (i >= 0) counts[i] += 1;
    };
    const id = String(p._id);
    if (p.countsFrom === "activities") acts.filter((a) => String(a.playId) === id).forEach((a) => add(a.at));
    else if (p.countsFrom === "content") content.filter((c) => String(c.playId) === id).forEach((c) => add(c.publishedAt));
    else if (p.countsFrom === "leads") leads.forEach((l) => add(l.createdAt));
    else if (p.countsFrom === "signups") signups.forEach((t) => add(t.createdAt));
    return { playId: id, weeks: counts };
  });
}

exports.getPlaybook = async (req, res, next) => {
  try {
    await ensureSeeded();
    const weeks = lastWeeks(4);
    const [plays, meta] = await Promise.all([HqPlaybookPlay.find({}).sort({ order: 1, createdAt: 1 }).lean(), HqSync.findOne({ key: "playbook" }).lean()]);
    const scores = new Map((await scoreboard(plays, weeks)).map((s) => [s.playId, s.weeks]));
    res.json({
      weeks: weeks.map((w) => w.key),
      meta: meta?.data || seed.META,
      plays: plays.map((p) => ({ ...p, done: scores.get(String(p._id)) || [0, 0, 0, 0] })),
    });
  } catch (err) {
    next(err);
  }
};

exports.createPlay = async (req, res, next) => {
  try {
    const body = pick(req.body);
    if (!String(body.title || "").trim()) return res.status(400).json({ message: "Give the play a name" });
    const last = await HqPlaybookPlay.findOne({}).sort({ order: -1 }).select("order").lean();
    const play = await HqPlaybookPlay.create({ ...body, order: (last?.order ?? -1) + 1 });
    res.status(201).json({ play });
  } catch (err) {
    next(err);
  }
};

exports.updatePlay = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: "Not found" });
    const play = await HqPlaybookPlay.findByIdAndUpdate(req.params.id, { $set: pick(req.body) }, { new: true, runValidators: true }).lean();
    if (!play) return res.status(404).json({ message: "Not found" });
    res.json({ play });
  } catch (err) {
    next(err);
  }
};

exports.deletePlay = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: "Not found" });
    await HqPlaybookPlay.deleteOne({ _id: req.params.id });
    await Promise.all([
      HqActivity.updateMany({ playId: req.params.id }, { $set: { playId: null } }),
      HqContentItem.updateMany({ playId: req.params.id }, { $set: { playId: null } }),
    ]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/** The week plan, tier rules, north star and note. */
exports.updateMeta = async (req, res, next) => {
  try {
    const b = req.body || {};
    const clean = {
      northStar: String(b.northStar || "").slice(0, 500),
      note: String(b.note || "").slice(0, 500),
      founders: (Array.isArray(b.founders) ? b.founders : []).slice(0, 4).map((x) => String(x).slice(0, 40)),
      week: (Array.isArray(b.week) ? b.week : []).slice(0, 7).map((r) => ({ day: String(r.day || "").slice(0, 20), a: String(r.a || "").slice(0, 300), b: String(r.b || "").slice(0, 300) })),
      tierRules: (Array.isArray(b.tierRules) ? b.tierRules : []).slice(0, 8).map((r) => ({ tier: String(r.tier || "").slice(0, 60), plays: String(r.plays || "").slice(0, 400) })),
    };
    await HqSync.updateOne({ key: "playbook" }, { $set: { data: clean } }, { upsert: true });
    res.json({ meta: clean });
  } catch (err) {
    next(err);
  }
};

module.exports.ensureSeeded = ensureSeeded;
