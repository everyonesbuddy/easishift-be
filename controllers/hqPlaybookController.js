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

const SEED_VERSION = 4;
// What we say to each buyer (on each buyer in the playbook).
const MESSAGE_FIELDS = ["promise", "pains", "proof", "angles", "cta", "avoid"];

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
  if (version < 4) await migrateV4();
  await HqSync.updateOne({ key: "playbook-seed" }, { $set: { data: { version: SEED_VERSION } } }, { upsert: true });
}

/**
 * Version 4: messaging by buyer, and the "Labor Math" newsletter (never sent)
 * becomes one Klaviyo content email a week. Only text nobody edited changes;
 * messaging is added to buyers that don't have it yet.
 */
async function migrateV4() {
  const { V4, PRE_V4, MESSAGING, META_V2, NEWSLETTER_V4, NL1_TITLE } = seed;
  await HqPlaybookPlay.updateOne({ seedKey: "newsletter", title: PRE_V4.newsletterTitle }, { $set: { title: NEWSLETTER_V4.title, ...NEWSLETTER_V4.fields } });
  await HqContentItem.updateOne({ seedKey: "nl-1", title: PRE_V4.nl1Title }, { $set: { title: NL1_TITLE } });

  const meta = await HqSync.findOne({ key: "playbook" }).lean();
  const d = meta?.data;
  if (!d) return;
  const set = {};
  if (d.overview === META_V2.overview) set["data.overview"] = V4.overview;
  if (d.connect === META_V2.connect) set["data.connect"] = V4.connect;
  if (Array.isArray(d.week)) set["data.week"] = d.week.map((r) => (r.b === PRE_V4.tuesday ? { ...r, b: seed.META.week.find((w) => w.day === "Tuesday").b } : r));
  if (Array.isArray(d.tierRules)) set["data.tierRules"] = d.tierRules.map((r) => (r.plays === PRE_V4.tiers34 ? { ...r, plays: seed.META.tierRules[2].plays } : r));
  if (Array.isArray(d.buyers)) {
    const oldHow = Object.fromEntries(META_V2.buyers.map((b) => [b.key, b.how]));
    set["data.buyers"] = d.buyers.map((b) => ({
      ...(MESSAGING[b.key] || {}),
      ...b,
      ...(V4.how[b.key] && b.how === oldHow[b.key] ? { how: V4.how[b.key] } : {}),
    }));
  }
  if (Array.isArray(d.channels)) {
    const old = META_V2.channels.find((c) => c.key === "newsletter");
    set["data.channels"] = d.channels.map((c) => (c.key === "newsletter" && c.why === old.why ? { ...c, ...V4.newsletterChannel } : c));
  }
  await HqSync.updateOne({ key: "playbook" }, { $set: set });
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
    HqActivity.find({ playId: { $in: ids }, at: { $gte: from, $lt: to } }).select("playId at count").lean(),
    HqContentItem.find({ playId: { $in: ids }, status: "published", publishedAt: { $gte: from, $lt: to } }).select("playId publishedAt").lean(),
    HqLead.find({ createdAt: { $gte: from, $lt: to } }).select("createdAt").lean(),
    Tenant.find({ createdAt: { $gte: from, $lt: to } }).select("createdAt").lean(),
  ]);
  const weekOf = (d) => weeks.findIndex((w) => d >= w.start && d < w.end);
  return plays.map((p) => {
    const counts = weeks.map(() => 0);
    const add = (d, n = 1) => {
      const i = weekOf(new Date(d));
      if (i >= 0) counts[i] += n;
    };
    const id = String(p._id);
    if (p.countsFrom === "activities") acts.filter((a) => String(a.playId) === id).forEach((a) => add(a.at, a.count || 1));
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
        ...Object.fromEntries(MESSAGE_FIELDS.map((f) => [f, String(x[f] || "").slice(0, 800)])),
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
module.exports.scoreboard = scoreboard;
