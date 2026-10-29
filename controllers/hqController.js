/**
 * HQ: WiserShifts' own command center (founders only; see
 * middleware/platformAdminMiddleware). Facilities we market to, the people
 * there, who signed up and how they're doing, what to do next, and the
 * marketing numbers from Klaviyo, GA4, Search Console, YouTube, LinkedIn
 * and the Contentful blog.
 */
const mongoose = require("mongoose");
const HqFacility = require("../models/hqFacilityModel");
const HqContact = require("../models/hqContactModel");
const HqActivity = require("../models/hqActivityModel");
const HqLead = require("../models/hqLeadModel");
const HqEmailSignal = require("../models/hqEmailSignalModel");
const HqSync = require("../models/hqSyncModel");
const HqLinkedinPost = require("../models/hqLinkedinPostModel");
const { loadWorkspaces } = require("../utils/hq/productSignals");
const { buildPlays } = require("../utils/hq/plays");
const { linkSignups } = require("../utils/hq/linkSignups");
const { LABELS, roleFromTitle } = require("../utils/hq/roles");
const { domainOf } = require("../utils/hq/domain");
const importCsv = require("../utils/hq/importCsv");
const klaviyo = require("../utils/hq/klaviyo");
const google = require("../utils/hq/google");
const youtube = require("../utils/hq/youtube");
const contentful = require("../utils/hq/contentful");

const HOUR = 60 * 60 * 1000;
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const by = (req) => req.user?.name || req.user?.email || "";
const errText = (err) =>
  err?.response?.data?.error?.message || err?.response?.data?.errors?.[0]?.detail || err?.response?.data?.message || err?.message || "Failed";

const FACILITY_FIELDS = [
  "name", "city", "state", "timeZone", "facilityType", "group", "buildingsInGroup", "website", "frontDeskPhone",
  "tier", "score", "whyTier", "stage", "attempts", "lastCallDate", "nextStep", "nextDate", "scheduler",
  "currentTool", "biggestPain", "notes",
];
const CONTACT_FIELDS = ["name", "title", "role", "email", "phone", "linkedin", "group", "facilityId", "facilityName", "priority", "rep", "emailReply", "dealClosed", "notes"];
const pick = (body, fields) => Object.fromEntries(fields.filter((f) => body?.[f] !== undefined).map((f) => [f, body[f]]));

/** email -> signal */
async function signalsFor(emails) {
  const list = emails.filter(Boolean);
  if (!list.length) return new Map();
  const rows = await HqEmailSignal.find({ email: { $in: list } }).lean();
  return new Map(rows.map((r) => [r.email, r]));
}

/** id -> newest activity date, for facilities and contacts */
async function lastTouchMap() {
  const rows = await HqActivity.aggregate([
    { $match: { kind: { $ne: "note" } } },
    { $group: { _id: { f: "$facilityId", c: "$contactId" }, at: { $max: "$at" } } },
  ]);
  const m = new Map();
  const bump = (k, at) => {
    if (!k) return;
    const key = String(k);
    if (!m.has(key) || m.get(key) < at) m.set(key, at);
  };
  for (const r of rows) {
    bump(r._id.f, r.at);
    bump(r._id.c, r.at);
  }
  return m;
}

/** Cached outside report (1 hour), refreshed on ?refresh=1. */
async function cached(key, ttlMs, refresh, load) {
  const doc = await HqSync.findOne({ key }).lean();
  if (!refresh && doc?.data && doc.lastOkAt && Date.now() - new Date(doc.lastOkAt) < ttlMs) {
    return { data: doc.data, fetchedAt: doc.lastOkAt, error: "" };
  }
  try {
    const data = await load();
    const now = new Date();
    await HqSync.updateOne({ key }, { $set: { data, lastOkAt: now, lastRunAt: now, error: "" } }, { upsert: true });
    return { data, fetchedAt: now, error: "" };
  } catch (err) {
    const error = errText(err).slice(0, 300);
    await HqSync.updateOne({ key }, { $set: { lastRunAt: new Date(), error } }, { upsert: true });
    // Show the last good copy if there is one.
    return { data: doc?.data || null, fetchedAt: doc?.lastOkAt || null, error };
  }
}

// ── Access / connections ────────────────────────────────────────────────────
exports.getAccess = (req, res) => res.json({ ok: true, email: req.user.email });

const CONNECTIONS = () => [
  { key: "klaviyo", name: "Klaviyo", configured: klaviyo.isConfigured(), env: ["KLAVIYO_PRIVATE_KEY", "KLAVIYO_LIST_ID"], what: "Email clicks per person (real vs scanner), calculator sign-ups" },
  { key: "ga4", name: "Google Analytics", configured: google.gaConfigured(), env: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GA4_PROPERTY_ID"], what: "Website visitors, top pages, sources, sign-ups" },
  { key: "gsc", name: "Search Console", configured: google.gscConfigured(), env: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GSC_SITE_URL"], what: "Google searches that found us, clicks, positions" },
  { key: "youtube", name: "YouTube", configured: youtube.isConfigured(), env: ["YOUTUBE_API_KEY", "YOUTUBE_CHANNEL_ID"], what: "Subscribers, views per video" },
  { key: "contentful", name: "Contentful", configured: contentful.isConfigured(), env: ["CONTENTFUL_SPACE_ID", "CONTENTFUL_DELIVERY_TOKEN", "CONTENTFUL_ENVIRONMENT"], what: "Blog posts" },
  { key: "linkedin", name: "LinkedIn", configured: true, env: [], what: "Upload your LinkedIn analytics export (no API for personal posts)" },
];

exports.getConnections = async (req, res, next) => {
  try {
    const syncs = await HqSync.find({}).select("key lastRunAt lastOkAt error").lean();
    const s = new Map(syncs.map((x) => [x.key, x]));
    const linkedinPosts = await HqLinkedinPost.countDocuments();
    res.json({
      connections: CONNECTIONS().map((c) => {
        const sync = s.get(c.key) || s.get({ ga4: "web", gsc: "search", youtube: "video", contentful: "blog" }[c.key]);
        return {
          ...c,
          lastOkAt: sync?.lastOkAt || null,
          error: sync?.error || "",
          ...(c.key === "linkedin" ? { configured: linkedinPosts > 0, posts: linkedinPosts } : {}),
        };
      }),
    });
  } catch (err) {
    next(err);
  }
};

// ── Overview ───────────────────────────────────────────────────────────────
exports.getOverview = async (req, res, next) => {
  try {
    const now = new Date();
    const workspaces = await loadWorkspaces({ now });
    await linkSignups(workspaces);
    const [facilities, contacts, roleCounts, emailTotals, leads7, plays] = await Promise.all([
      HqFacility.countDocuments(),
      HqContact.countDocuments(),
      HqContact.aggregate([{ $group: { _id: "$role", n: { $sum: 1 } } }]),
      HqEmailSignal.aggregate([
        { $group: { _id: null, people: { $sum: 1 }, delivered: { $sum: "$delivered" }, human: { $sum: "$humanClicks" }, bot: { $sum: "$botClicks" }, clickers: { $sum: { $cond: [{ $gt: ["$humanClicks", 0] }, 1, 0] } } } },
      ]),
      HqLead.countDocuments({ createdAt: { $gte: new Date(now - 7 * 24 * HOUR) } }),
      computePlays(now, workspaces),
    ]);
    const week = 7 * 24 * HOUR;
    res.json({
      facilities,
      contacts,
      contactsByRole: Object.fromEntries(roleCounts.map((r) => [r._id || "other", r.n])),
      roleLabels: LABELS,
      signups: {
        total: workspaces.length,
        last7: workspaces.filter((w) => now - new Date(w.createdAt) <= week).length,
        active: workspaces.filter((w) => w.active).length,
        paid: workspaces.filter((w) => w.paid).length,
        trialing: workspaces.filter((w) => w.trialDaysLeft !== null).length,
      },
      email: emailTotals[0] ? { ...emailTotals[0], _id: undefined } : { people: 0, delivered: 0, human: 0, bot: 0, clickers: 0 },
      leads7,
      plays: { total: plays.length, today: plays.filter((p) => p.priority === 1).length, top: plays.slice(0, 6) },
      connections: CONNECTIONS().map(({ key, name, configured }) => ({ key, name, configured })),
    });
  } catch (err) {
    next(err);
  }
};

// ── Plays ──────────────────────────────────────────────────────────────────
async function computePlays(now, workspaces) {
  const [facilities, contacts, lastTouch, done] = await Promise.all([
    HqFacility.find({}).select("name group tenantId tier stage nextDate nextStep scheduler").lean(),
    HqContact.find({}).select("name title role email group facilityId").lean(),
    lastTouchMap(),
    HqActivity.distinct("playKey", { playKey: { $type: "string" } }),
  ]);
  const signals = await signalsFor(contacts.map((c) => c.email));
  const plays = buildPlays({ workspaces, facilities, contacts, signals, lastTouch, doneKeys: new Set(done), now });
  const fName = new Map(facilities.map((f) => [String(f._id), f.name]));
  const cName = new Map(contacts.map((c) => [String(c._id), { name: c.name, title: c.title, email: c.email }]));
  return plays.map((p) => ({
    ...p,
    roleLabel: LABELS[p.role] || "",
    facilityName: p.facilityId ? fName.get(p.facilityId) || "" : "",
    contact: p.contactId ? cName.get(p.contactId) || null : null,
  }));
}

exports.getPlays = async (req, res, next) => {
  try {
    const now = new Date();
    const workspaces = await loadWorkspaces({ now });
    await linkSignups(workspaces);
    let plays = await computePlays(now, workspaces);
    if (req.query.role) plays = plays.filter((p) => p.role === req.query.role);
    if (req.query.kind) plays = plays.filter((p) => p.kind === req.query.kind);
    res.json({ plays });
  } catch (err) {
    next(err);
  }
};

exports.completePlay = async (req, res, next) => {
  try {
    const { key, notes = "", outcome = "Done", facilityId = null, contactId = null } = req.body || {};
    if (!key || typeof key !== "string") return res.status(400).json({ message: "key is required" });
    const act = await HqActivity.create({
      playKey: key.slice(0, 200),
      kind: "note",
      outcome: String(outcome).slice(0, 200),
      notes: String(notes).slice(0, 4000),
      facilityId: isId(facilityId) ? facilityId : null,
      contactId: isId(contactId) ? contactId : null,
      by: by(req),
    });
    res.status(201).json({ activity: act });
  } catch (err) {
    next(err);
  }
};

// ── Facilities ─────────────────────────────────────────────────────────────
exports.listFacilities = async (req, res, next) => {
  try {
    const { q, tier, stage, state, group, customers, sort = "tier" } = req.query;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const page = Math.max(1, Number(req.query.page) || 1);
    const filter = {};
    if (q) {
      const re = new RegExp(escapeRe(q), "i");
      filter.$or = [{ name: re }, { group: re }, { city: re }, { ref: re }, { "scheduler.name": re }];
    }
    if (tier) filter.tier = Number(tier);
    if (stage) filter.stage = stage;
    if (state) filter.state = state;
    if (group) filter.group = group;
    if (customers === "1") filter.tenantId = { $ne: null };
    if (customers === "0") filter.tenantId = null;
    const sorts = { tier: { tier: 1, score: -1, name: 1 }, name: { name: 1 }, next: { nextDate: 1 }, recent: { updatedAt: -1 } };
    const [rows, total, stages, states] = await Promise.all([
      HqFacility.find(filter).sort(sorts[sort] || sorts.tier).skip((page - 1) * limit).limit(limit).lean(),
      HqFacility.countDocuments(filter),
      HqFacility.distinct("stage"),
      HqFacility.distinct("state"),
    ]);
    const ids = rows.map((r) => r._id);
    const contacts = await HqContact.find({ facilityId: { $in: ids } }).select("facilityId role email").lean();
    const signals = await signalsFor(contacts.map((c) => c.email));
    const per = new Map();
    for (const c of contacts) {
      const k = String(c.facilityId);
      const e = per.get(k) || { contacts: 0, leaders: 0, humanClicks: 0 };
      e.contacts += 1;
      if (c.role !== "scheduler" && c.role !== "other") e.leaders += 1;
      e.humanClicks += signals.get(c.email)?.humanClicks || 0;
      per.set(k, e);
    }
    res.json({
      total,
      page,
      limit,
      stages: stages.filter(Boolean).sort(),
      states: states.filter(Boolean).sort(),
      facilities: rows.map((r) => ({ ...r, ...(per.get(String(r._id)) || { contacts: 0, leaders: 0, humanClicks: 0 }), customer: Boolean(r.tenantId) })),
    });
  } catch (err) {
    next(err);
  }
};

exports.getFacility = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: "Not found" });
    const facility = await HqFacility.findById(req.params.id).lean();
    if (!facility) return res.status(404).json({ message: "Not found" });
    const [contacts, activities, workspace, sameGroup] = await Promise.all([
      HqContact.find({ facilityId: facility._id }).sort({ role: 1, name: 1 }).lean(),
      HqActivity.find({ facilityId: facility._id }).sort({ at: -1 }).limit(100).lean(),
      facility.tenantId ? loadWorkspaces({ tenantIds: [facility.tenantId] }).then((w) => w[0] || null) : null,
      facility.group
        ? HqFacility.find({ group: facility.group, _id: { $ne: facility._id } }).select("name city state tenantId tier stage").limit(50).lean()
        : [],
    ]);
    // Group-level people (e.g. a regional VP) without a building.
    const groupContacts = facility.group
      ? await HqContact.find({ group: facility.group, facilityId: { $ne: facility._id } }).select("name title role email phone linkedin facilityName").limit(50).lean()
      : [];
    const signals = await signalsFor([...contacts, ...groupContacts].map((c) => c.email));
    const withSignal = (c) => ({ ...c, signal: signals.get(c.email) || null });
    res.json({
      facility,
      contacts: contacts.map(withSignal),
      groupContacts: groupContacts.map(withSignal),
      activities,
      workspace,
      sameGroup,
    });
  } catch (err) {
    next(err);
  }
};

exports.createFacility = async (req, res, next) => {
  try {
    const body = pick(req.body, FACILITY_FIELDS);
    if (!String(body.name || "").trim()) return res.status(400).json({ message: "name is required" });
    body.domain = domainOf(body.website);
    const facility = await HqFacility.create({ ...body, source: "manual" });
    res.status(201).json({ facility });
  } catch (err) {
    next(err);
  }
};

exports.updateFacility = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: "Not found" });
    const body = pick(req.body, FACILITY_FIELDS);
    if (body.website !== undefined) body.domain = domainOf(body.website);
    const facility = await HqFacility.findByIdAndUpdate(req.params.id, { $set: body }, { new: true, runValidators: true }).lean();
    if (!facility) return res.status(404).json({ message: "Not found" });
    res.json({ facility });
  } catch (err) {
    next(err);
  }
};

// ── Contacts (people) ──────────────────────────────────────────────────────
exports.listContacts = async (req, res, next) => {
  try {
    const { q, role, group, engaged } = req.query;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const page = Math.max(1, Number(req.query.page) || 1);
    const filter = {};
    if (q) {
      const re = new RegExp(escapeRe(q), "i");
      filter.$or = [{ name: re }, { email: re }, { title: re }, { group: re }, { facilityName: re }];
    }
    if (role) filter.role = role === "leadership" ? { $in: ["executive_director", "administrator", "don", "regional", "owner"] } : role;
    if (group) filter.group = group;
    if (engaged === "1") {
      const clickers = await HqEmailSignal.find({ humanClicks: { $gt: 0 } }).select("email").lean();
      filter.email = { $in: clickers.map((c) => c.email) };
    }
    const [rows, total] = await Promise.all([
      HqContact.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      HqContact.countDocuments(filter),
    ]);
    const signals = await signalsFor(rows.map((r) => r.email));
    const contacts = rows.map((r) => ({ ...r, signal: signals.get(r.email) || null }));
    if (engaged === "1") contacts.sort((a, b) => (b.signal?.humanClicks || 0) - (a.signal?.humanClicks || 0));
    res.json({ total, page, limit, roleLabels: LABELS, contacts });
  } catch (err) {
    next(err);
  }
};

exports.createContact = async (req, res, next) => {
  try {
    const body = pick(req.body, CONTACT_FIELDS);
    if (!body.name && !body.email) return res.status(400).json({ message: "name or email is required" });
    if (body.facilityId && !isId(body.facilityId)) body.facilityId = null;
    if (!body.role) body.role = roleFromTitle(body.title);
    const contact = await HqContact.create({ ...body, source: "manual" });
    res.status(201).json({ contact });
  } catch (err) {
    next(err);
  }
};

exports.updateContact = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: "Not found" });
    const body = pick(req.body, CONTACT_FIELDS);
    if (body.facilityId !== undefined && body.facilityId && !isId(body.facilityId)) body.facilityId = null;
    const contact = await HqContact.findByIdAndUpdate(req.params.id, { $set: body }, { new: true, runValidators: true }).lean();
    if (!contact) return res.status(404).json({ message: "Not found" });
    res.json({ contact });
  } catch (err) {
    next(err);
  }
};

// ── Activities (log a call, email, note) ───────────────────────────────────
exports.createActivity = async (req, res, next) => {
  try {
    const { facilityId, contactId, kind = "note", outcome = "", notes = "", at, nextDate, nextStep, stage, playKey } = req.body || {};
    if (!isId(facilityId) && !isId(contactId)) return res.status(400).json({ message: "facilityId or contactId is required" });
    let fid = isId(facilityId) ? facilityId : null;
    if (!fid && isId(contactId)) fid = (await HqContact.findById(contactId).select("facilityId").lean())?.facilityId || null;
    const activity = await HqActivity.create({
      facilityId: fid,
      contactId: isId(contactId) ? contactId : null,
      kind: ["call", "email", "linkedin", "meeting", "note"].includes(kind) ? kind : "note",
      outcome: String(outcome).slice(0, 200),
      notes: String(notes).slice(0, 4000),
      at: at ? new Date(at) : new Date(),
      nextDate: nextDate ? new Date(nextDate) : null,
      playKey: typeof playKey === "string" && playKey ? playKey.slice(0, 200) : null,
      by: by(req),
    });
    // Keep the facility's call-list columns current.
    if (fid) {
      const set = {};
      const inc = {};
      if (kind === "call") {
        set.lastCallDate = activity.at;
        inc.attempts = 1;
      }
      if (nextDate !== undefined) set.nextDate = nextDate ? new Date(nextDate) : null;
      if (nextStep !== undefined) set.nextStep = String(nextStep).slice(0, 200);
      if (stage) set.stage = String(stage).slice(0, 100);
      if (Object.keys(set).length || Object.keys(inc).length) {
        await HqFacility.updateOne({ _id: fid }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(inc).length ? { $inc: inc } : {}) });
      }
    }
    res.status(201).json({ activity });
  } catch (err) {
    next(err);
  }
};

exports.listActivities = async (req, res, next) => {
  try {
    const filter = {};
    if (isId(req.query.facilityId)) filter.facilityId = req.query.facilityId;
    if (isId(req.query.contactId)) filter.contactId = req.query.contactId;
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const activities = await HqActivity.find(filter).sort({ at: -1 }).limit(limit).populate("facilityId", "name").populate("contactId", "name").lean();
    res.json({ activities });
  } catch (err) {
    next(err);
  }
};

// ── Import ─────────────────────────────────────────────────────────────────
exports.importCsv = async (req, res, next) => {
  try {
    const { kind } = req.params;
    if (!importCsv.KINDS.includes(kind)) return res.status(400).json({ message: `kind must be one of ${importCsv.KINDS.join(", ")}` });
    const text = req.file ? req.file.buffer.toString("utf8") : req.body?.csv;
    if (!text) return res.status(400).json({ message: "Attach a CSV file (field: file) or send { csv }" });
    const tier = Number(req.body?.tier || req.query.tier) || null;
    const { rows, matchedColumns, totalRows } = importCsv.normalize(kind, text, { defaultTier: tier });
    if (!matchedColumns.length) return res.status(400).json({ message: "None of the columns were recognized. Check you exported the right tab." });
    const dryRun = String(req.body?.dryRun ?? req.query.dryRun ?? "") === "1" || req.body?.dryRun === true;
    if (dryRun) return res.json({ dryRun: true, totalRows, usable: rows.length, matchedColumns, sample: rows.slice(0, 5) });
    const result = await importCsv.apply(kind, rows, { by: by(req) });
    res.json({ dryRun: false, totalRows, usable: rows.length, matchedColumns, ...result });
  } catch (err) {
    next(err);
  }
};

// ── Signups & leads ────────────────────────────────────────────────────────
exports.getSignups = async (req, res, next) => {
  try {
    const workspaces = await loadWorkspaces();
    await linkSignups(workspaces);
    const facilities = await HqFacility.find({ tenantId: { $in: workspaces.map((w) => w.tenantId) } }).select("tenantId group tier").lean();
    const fBy = new Map(facilities.map((f) => [String(f.tenantId), f]));
    const leads = await HqLead.find({}).sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      workspaces: workspaces.map((w) => ({ ...w, facilityId: fBy.get(w.tenantId)?._id || null, group: fBy.get(w.tenantId)?.group || "" })),
      leads,
    });
  } catch (err) {
    next(err);
  }
};

// ── Content & marketing numbers ────────────────────────────────────────────
exports.getContent = async (req, res, next) => {
  try {
    const refresh = req.query.refresh === "1";
    const [blog, video, linkedin] = await Promise.all([
      contentful.isConfigured() ? cached("blog", HOUR, refresh, () => contentful.listPosts()) : { data: null, error: "not_configured" },
      youtube.isConfigured() ? cached("video", HOUR, refresh, () => youtube.channelSummary()) : { data: null, error: "not_configured" },
      HqLinkedinPost.find({}).sort({ postedAt: -1 }).limit(100).lean(),
    ]);
    // Blog page views from GA4, if connected (path /blog/<slug>).
    let blogViews = {};
    if (google.gaConfigured() && blog.data?.length) {
      const web = await cached("web", HOUR, false, () => google.webSummary());
      for (const p of web.data?.pages || []) {
        const m = String(p.pagePath).match(/^\/blog\/([^/?#]+)/);
        if (m) blogViews[m[1]] = (blogViews[m[1]] || 0) + p.screenPageViews;
      }
    }
    res.json({
      blog: { ...blog, data: blog.data ? blog.data.map((p) => ({ ...p, views28: blogViews[p.slug] ?? null })) : null },
      video,
      linkedin: { posts: linkedin },
    });
  } catch (err) {
    next(err);
  }
};

exports.getWeb = async (req, res, next) => {
  try {
    const refresh = req.query.refresh === "1";
    const [analytics, search] = await Promise.all([
      google.gaConfigured() ? cached("web", HOUR, refresh, () => google.webSummary()) : { data: null, error: "not_configured" },
      google.gscConfigured() ? cached("search", HOUR * 6, refresh, () => google.searchSummary()) : { data: null, error: "not_configured" },
    ]);
    res.json({ analytics, search });
  } catch (err) {
    next(err);
  }
};

exports.getEmail = async (req, res, next) => {
  try {
    const [top, totals, sync] = await Promise.all([
      HqEmailSignal.find({ humanClicks: { $gt: 0 } }).sort({ humanClicks: -1, lastHumanClickAt: -1 }).limit(100).lean(),
      HqEmailSignal.aggregate([{ $group: { _id: null, people: { $sum: 1 }, delivered: { $sum: "$delivered" }, human: { $sum: "$humanClicks" }, bot: { $sum: "$botClicks" } } }]),
      HqSync.findOne({ key: "klaviyo" }).select("lastOkAt lastRunAt error").lean(),
    ]);
    const contacts = await HqContact.find({ email: { $in: top.map((t) => t.email) } }).select("name title role email group facilityId facilityName").lean();
    const cBy = new Map(contacts.map((c) => [c.email, c]));
    res.json({
      configured: klaviyo.isConfigured(),
      sync,
      totals: totals[0] ? { ...totals[0], _id: undefined } : { people: 0, delivered: 0, human: 0, bot: 0 },
      clickers: top.map((t) => ({ ...t, contact: cBy.get(t.email) || null })),
    });
  } catch (err) {
    next(err);
  }
};

exports.syncKlaviyo = async (req, res, next) => {
  try {
    if (!klaviyo.isConfigured()) return res.status(400).json({ message: "Klaviyo isn't connected yet (KLAVIYO_PRIVATE_KEY)." });
    const result = await klaviyo.syncEmailSignals();
    if (!result.ok) return res.status(502).json({ message: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
