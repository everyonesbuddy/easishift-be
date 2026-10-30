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

const SEED_VERSION = 3;

/**
 * Load the starting playbook and content once, in versions: version 1 is the
 * plays and first ideas; version 2 adds the written playbook (buyers,
 * channels), the LinkedIn post plan and more video and Facebook ideas.
 * Each version runs once, so anything you delete stays deleted.
 */
async function ensureSeeded() {
  const state = await HqSync.findOne({ key: "playbook-seed" }).lean();
  let version = state?.data?.version || 0;
  if (version >= SEED_VERSION) return;
  if (version < 1) {
    await seedV1();
    version = 1;
  }
  if (version < 2) {
    const plays = new Map((await HqPlaybookPlay.find({ seedKey: { $ne: null } }).select("seedKey").lean()).map((p) => [p.seedKey, p._id]));
    for (const c of seed.CONTENT_V2) {
      const { play, ...item } = c;
      await HqContentItem.updateOne({ seedKey: c.seedKey }, { $setOnInsert: { ...item, playId: plays.get(play) || null } }, { upsert: true });
    }
    const meta = await HqSync.findOne({ key: "playbook" }).lean();
    const add = {};
    for (const k of ["overview", "connect", "buyers", "channels"]) if (!meta?.data?.[k]) add[`data.${k}`] = seed.META_V2[k];
    if (Object.keys(add).length) await HqSync.updateOne({ key: "playbook" }, { $set: add }, { upsert: true });
    // The plan is three LinkedIn posts a week.
    await HqPlaybookPlay.updateOne({ seedKey: "linkedin-posts", weeklyTarget: 2 }, { $set: { weeklyTarget: 3, volume: "3 posts a week: Tuesday 11:30 a.m., Wednesday 4 p.m., Thursday 1:30 p.m. ET." } });
  }
  if (version < 3) {
    // Klaviyo is content; emails from your own inbox are cold outreach. Only text nobody has edited is changed.
    const meta = await HqSync.findOne({ key: "playbook" }).lean();
    if (meta?.data?.channels) {
      const channels = meta.data.channels.map((c) =>
        seed.V3_CHANNELS[c.key] && (c.why === seed.V2_CHANNEL_TEXT[c.key] || !c.why) ? { ...c, name: seed.V3_CHANNELS[c.key].name, why: seed.V3_CHANNELS[c.key].why } : c,
      );
      await HqSync.updateOne({ key: "playbook" }, { $set: { "data.channels": channels } });
    }
    await HqPlaybookPlay.updateOne({ seedKey: "calculator-followup", channel: "email" }, { $set: { channel: "newsletter" } });
    await HqPlaybookPlay.updateOne({ seedKey: "email-hprd", title: "\"Your hours per resident day\" email" }, { $set: { title: "\"Your hours per resident day\" cold email" } });
    await HqPlaybookPlay.updateOne({ seedKey: "email-operator", title: "One-building pilot email" }, { $set: { title: "One-building pilot cold email" } });
  }
  await HqSync.updateOne({ key: "playbook-seed" }, { $set: { data: { version: SEED_VERSION } } }, { upsert: true });
}

async function seedV1() {
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
      meta: { ...seed.META, ...seed.META_V2, ...(meta?.data || {}) },
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
      overview: String(b.overview || "").slice(0, 3000),
      connect: String(b.connect || "").slice(0, 3000),
      buyers: (Array.isArray(b.buyers) ? b.buyers : []).slice(0, 6).map((x) => ({
        key: String(x.key || "").slice(0, 30),
        name: String(x.name || "").slice(0, 80),
        who: String(x.who || "").slice(0, 600),
        cares: String(x.cares || "").slice(0, 600),
        where: String(x.where || "").slice(0, 600),
        offer: String(x.offer || "").slice(0, 600),
        how: String(x.how || "").slice(0, 600),
      })),
      channels: (Array.isArray(b.channels) ? b.channels : []).slice(0, 12).map((x) => ({ key: String(x.key || "").slice(0, 30), name: String(x.name || "").slice(0, 60), why: String(x.why || "").slice(0, 800) })),
    };
    await HqSync.updateOne({ key: "playbook" }, { $set: { data: clean } }, { upsert: true });
    res.json({ meta: clean });
  } catch (err) {
    next(err);
  }
};

module.exports.ensureSeeded = ensureSeeded;
