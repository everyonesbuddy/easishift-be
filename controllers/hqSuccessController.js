/**
 * HQ customer success: the workspaces we look after, how healthy each one
 * is (worked out fresh from its data), the checklist for its stage, the
 * next check-in and the log. Paying workspaces are added by themselves.
 */
const mongoose = require("mongoose");
const HqCustomer = require("../models/hqCustomerModel");
const HqMoneyHidden = require("../models/hqMoneyHiddenModel");
const Tenant = require("../models/tenantModel");
const User = require("../models/userModel");
const StaffLink = require("../models/staffLinkModel");
const CalloutOffer = require("../models/calloutOfferModel");
const { findSchedulers } = require("../utils/schedulers");
const { factsFor } = require("../utils/morningSummaryJobs");
const cs = require("../utils/hq/success");

const fail = (res, status, message) => res.status(status).json({ message });
const isId = (v) => mongoose.isValidObjectId(String(v || ""));
const TENANT_FIELDS = "name plan subscriptionStatus trialEndsAt createdAt setupCompletedAt stripeCustomerId stripeSubscriptionId";
const PAYING = ["active", "past_due"];

/** Everything health and the checklist look at, for one workspace. */
async function signalsFor(tenant, now = new Date()) {
  const since14 = new Date(now.getTime() - 14 * cs.DAY);
  const since30 = new Date(now.getTime() - 30 * cs.DAY);
  const [facts, managers, opened, offers, filled] = await Promise.all([
    factsFor(tenant, now),
    findSchedulers(tenant._id).select("name lastSeenAt phoneE164 smsConsent").lean(),
    StaffLink.distinct("staffId", { tenantId: tenant._id, lastUsedAt: { $gte: since14 } }),
    CalloutOffer.countDocuments({ tenantId: tenant._id, createdAt: { $gte: since30 } }),
    CalloutOffer.countDocuments({ tenantId: tenant._id, status: "filled", createdAt: { $gte: since30 } }),
  ]);
  const seen = managers.map((m) => m.lastSeenAt).filter(Boolean).sort((a, b) => new Date(b) - new Date(a));
  const s = facts.setup;
  return {
    plan: tenant.plan,
    subscriptionStatus: tenant.subscriptionStatus,
    staff: s.staff,
    staffWithPhone: s.staffWithPhone,
    optedIn: s.optedIn,
    smsPlan: s.smsPlan,
    thisWeekPublished: s.thisWeekPublished,
    nextWeekPublished: s.nextWeekPublished,
    weekday: s.weekday,
    setupDone: s.setupDone,
    managers: managers.length,
    managersOptedIn: managers.filter((m) => m.phoneE164 && m.smsConsent?.status === "opted_in").length,
    lastManagerSeenAt: seen[0] || null,
    staffOpened14: opened.length,
    callouts30: offers,
    calloutsFilled30: filled,
    openToday: facts.open.length,
    timezone: facts.timezone,
  };
}

// Signals are a handful of queries per workspace; keep them five minutes.
const cache = new Map(); // tenantId → { at, s }
async function cachedSignals(tenant, now, refresh) {
  const key = String(tenant._id);
  const hit = cache.get(key);
  if (!refresh && hit && now - hit.at < 5 * 60 * 1000) return hit.s;
  const s = await signalsFor(tenant, now);
  cache.set(key, { at: now, s });
  return s;
}

/** Make sure every paying workspace is here (skipping ones hidden as tests on the Money page). */
async function addPaying(now = new Date()) {
  const hidden = (await HqMoneyHidden.find().select("customerId").lean()).map((h) => h.customerId);
  const paying = await Tenant.find({ subscriptionStatus: { $in: PAYING }, plan: { $ne: "free" }, ...(hidden.length ? { stripeCustomerId: { $nin: hidden } } : {}) }).select("_id").lean();
  for (const t of paying) {
    await HqCustomer.updateOne({ tenantId: t._id }, { $setOnInsert: { tenantId: t._id, stage: "onboarding", stageAt: now, startedAt: now, nextCheckInAt: new Date(now.getTime() + 2 * cs.DAY) } }, { upsert: true });
  }
}

/** One customer with its workspace, health and checklist. */
async function shape(c, tenant, now, refresh) {
  let s = null;
  let error = "";
  try {
    s = tenant ? await cachedSignals(tenant, now, refresh) : null;
  } catch (e) {
    error = "Couldn't read this workspace's data.";
  }
  const h = s ? cs.health(s, { now, startedAt: c.startedAt }) : { level: "unknown", reasons: [error || "The workspace is gone."] };
  return {
    _id: String(c._id),
    tenantId: String(c.tenantId),
    name: tenant?.name || "(workspace removed)",
    owner: c.owner,
    stage: c.stage,
    stageLabel: cs.STAGES[c.stage],
    stageAt: c.stageAt,
    startedAt: c.startedAt,
    day: Math.max(0, Math.floor((now - new Date(c.startedAt)) / cs.DAY)),
    nextCheckInAt: c.nextCheckInAt,
    renewsAt: c.renewsAt,
    notes: c.notes,
    health: h,
    signals: s,
    checklist: cs.checklist(c, s, now),
    log: [...(c.log || [])].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100),
  };
}

async function load(now, refresh) {
  await addPaying(now);
  const customers = await HqCustomer.find({}).lean();
  const tenants = new Map((await Tenant.find({ _id: { $in: customers.map((c) => c.tenantId) } }).select(TENANT_FIELDS).lean()).map((t) => [String(t._id), t]));
  const out = [];
  for (const c of customers) out.push(await shape(c, tenants.get(String(c.tenantId)), now, refresh));
  const rank = { red: 0, yellow: 1, unknown: 2, green: 3 };
  return out.sort((a, b) => (a.stage === "churned") - (b.stage === "churned") || rank[a.health.level] - rank[b.health.level] || a.name.localeCompare(b.name));
}

/** GET /hq/success: every customer, worst first, plus what's due. */
exports.list = async (req, res, next) => {
  try {
    const now = new Date();
    const customers = await load(now, req.query.refresh === "1");
    res.json({ customers, stages: cs.STAGES, todos: cs.todos(customers, { now }) });
  } catch (err) {
    next(err);
  }
};

/** POST /hq/success { email | q }: look after a workspace that isn't paying yet (a trial, a pilot). */
exports.add = async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim();
    const q = String(req.body?.q || "").trim();
    const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    let tenant = null;
    if (email.includes("@")) {
      const u = await User.findOne({ email: new RegExp(`^${esc(email)}$`, "i") }).select("tenantId").lean();
      if (u) tenant = await Tenant.findById(u.tenantId).select(TENANT_FIELDS).lean();
    } else if (q || email) {
      tenant = await Tenant.findOne({ name: new RegExp(esc(q || email), "i") }).select(TENANT_FIELDS).lean();
    }
    if (!tenant) return fail(res, 404, "No workspace found for that.");
    const now = new Date();
    await HqCustomer.updateOne({ tenantId: tenant._id }, { $setOnInsert: { tenantId: tenant._id, stage: "onboarding", stageAt: now, startedAt: now, nextCheckInAt: new Date(now.getTime() + 2 * cs.DAY) } }, { upsert: true });
    const c = await HqCustomer.findOne({ tenantId: tenant._id }).lean();
    res.status(201).json(await shape(c, tenant, now));
  } catch (err) {
    next(err);
  }
};

async function findCustomer(req, res) {
  if (!isId(req.params.id)) return fail(res, 404, "That customer is gone"), null;
  const c = await HqCustomer.findById(req.params.id);
  if (!c) return fail(res, 404, "That customer is gone"), null;
  return c;
}
async function respond(res, c) {
  const now = new Date();
  const tenant = await Tenant.findById(c.tenantId).select(TENANT_FIELDS).lean();
  res.json(await shape(c.toObject(), tenant, now));
}

/**
 * PATCH /hq/success/:id { owner, stage, nextCheckInAt, renewsAt, notes, tick: { key, done } }
 * Moving to At risk sets the next check-in to the next business day.
 */
exports.update = async (req, res, next) => {
  try {
    const c = await findCustomer(req, res);
    if (!c) return;
    const b = req.body || {};
    const now = new Date();
    if (b.owner !== undefined) c.owner = String(b.owner || "").trim().slice(0, 80);
    if (b.notes !== undefined) c.notes = String(b.notes || "").slice(0, 8000);
    for (const k of ["nextCheckInAt", "renewsAt"]) {
      if (b[k] === undefined) continue;
      const d = b[k] ? new Date(b[k]) : null;
      c[k] = d && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (b.stage !== undefined && cs.STAGES[b.stage] && b.stage !== c.stage) {
      c.stage = b.stage;
      c.stageAt = now;
      if (b.stage === "at_risk") c.nextCheckInAt = cs.nextBusinessDay(now);
      if (b.stage === "churned") c.nextCheckInAt = null;
    }
    if (b.tick?.key) {
      const key = String(b.tick.key).slice(0, 120);
      if (b.tick.done) c.done.set(key, now);
      else c.done.delete(key);
    }
    await c.save();
    await respond(res, c);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /hq/success/:id/log { kind, text, at? }
 * A call, visit or meeting counts as the check-in and sets the next one
 * (every 3 days at risk, weekly for 90 days, then every two weeks).
 */
exports.log = async (req, res, next) => {
  try {
    const c = await findCustomer(req, res);
    if (!c) return;
    const b = req.body || {};
    const kind = ["call", "visit", "meeting", "email", "text", "note"].includes(b.kind) ? b.kind : "note";
    const text = String(b.text || "").trim().slice(0, 4000);
    if (!text && kind === "note") return fail(res, 400, "Write what happened.");
    const at = b.at && !Number.isNaN(new Date(b.at).getTime()) ? new Date(b.at) : new Date();
    c.log.push({ at, kind, text, by: req.hqUser?.name || req.hqUser?.email || "" });
    if (["call", "visit", "meeting"].includes(kind)) {
      const days = cs.cadenceDays(c.stage, c.startedAt, at);
      if (days) c.nextCheckInAt = new Date(at.getTime() + days * cs.DAY);
    }
    await c.save();
    await respond(res, c);
  } catch (err) {
    next(err);
  }
};

/** DELETE /hq/success/:id/log/:entryId: take back a log entry. */
exports.removeLog = async (req, res, next) => {
  try {
    const c = await findCustomer(req, res);
    if (!c) return;
    c.log = c.log.filter((e) => String(e._id) !== String(req.params.entryId));
    await c.save();
    await respond(res, c);
  } catch (err) {
    next(err);
  }
};

/** To-dos for This week; never fails the page. */
exports.todos = async (now = new Date(), tz) => {
  try {
    return cs.todos(await load(now, false), { now, tz });
  } catch {
    return [];
  }
};

exports._test = { signalsFor, shape };
