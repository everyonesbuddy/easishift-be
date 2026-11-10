/**
 * HQ government contracts: federal listings from SAM.gov (pulled daily),
 * state, county and city ones added by hand, and where we stand on each,
 * from new through reviewing and bidding to won or lost.
 */
const mongoose = require("mongoose");
const HqGovListing = require("../models/hqGovListingModel");
const gov = require("../utils/hq/gov");
const sam = require("../utils/hq/samGov");
const fb = require("../utils/hq/facebook");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const fail = (res, status, message) => res.status(status).json({ message });

const TEXT = ["title", "agency", "state", "solicitationNumber", "value", "notes", "url"];
const DATES = ["dueAt", "questionsDueAt"];
const LEVELS = ["federal", "state", "county", "city", "other"];

/** What can be set from HQ, cleaned. */
function clean(b = {}) {
  const out = {};
  for (const k of TEXT) if (b[k] !== undefined) out[k] = String(b[k] || "").trim().slice(0, k === "notes" ? 8000 : 400);
  if (out.url !== undefined) out.url = out.url ? fb.fullUrl(out.url) : "";
  if (out.state !== undefined) out.state = out.state.slice(0, 40);
  for (const k of DATES) {
    if (b[k] === undefined) continue;
    const d = b[k] ? new Date(b[k]) : null;
    out[k] = d && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (b.level !== undefined && LEVELS.includes(b.level)) out.level = b.level;
  if (b.status !== undefined && gov.STATUSES[b.status]) out.status = b.status;
  if (Array.isArray(b.checklist)) {
    out.checklist = b.checklist
      .map((c) => ({ text: String(c?.text || "").trim().slice(0, 300), done: Boolean(c?.done) }))
      .filter((c) => c.text)
      .slice(0, 40);
  }
  return out;
}

const shape = (l) => ({ ...l, _id: String(l._id), statusLabel: gov.STATUSES[l.status] || l.status });

async function feedState() {
  const s = await sam.state();
  return { on: sam.isConfigured(), lastFetchAt: s.lastFetchAt || null, lastError: s.lastError || "", lastAdded: s.lastAdded ?? null };
}

/** GET /hq/gov: everything, newest first within each status, plus the feed's state and the deadlines. */
exports.list = async (req, res, next) => {
  try {
    const listings = (await HqGovListing.find({}).sort({ dueAt: 1, createdAt: -1 }).limit(2000).lean()).map(shape);
    res.json({ listings, statuses: gov.STATUSES, feed: await feedState(), deadlines: gov.deadlineTodos(listings), checklist: gov.CHECKLIST });
  } catch (err) {
    next(err);
  }
};

/** POST /hq/gov: add a listing by hand (state, county, city, or a federal one the feed missed). */
exports.create = async (req, res, next) => {
  try {
    const body = clean(req.body);
    if (!body.title) return fail(res, 400, "Give it a title.");
    const status = body.status && body.status !== "new" ? body.status : "reviewing";
    const doc = await HqGovListing.create({ level: "state", ...body, source: "manual", status, statusAt: new Date(), checklist: body.checklist || (status === "bidding" ? gov.CHECKLIST.map((text) => ({ text, done: false })) : []) });
    res.status(201).json(shape(doc.toObject()));
  } catch (err) {
    next(err);
  }
};

/** PATCH /hq/gov/:id: status, dates, notes, checklist. Moving to bidding adds the checklist if it has none. */
exports.update = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, "That listing is gone");
    const l = await HqGovListing.findById(req.params.id).lean();
    if (!l) return fail(res, 404, "That listing is gone");
    const set = clean(req.body);
    if (set.title === "") delete set.title;
    if (set.status && set.status !== l.status) {
      set.statusAt = new Date();
      if (set.status === "bidding" && !(set.checklist || l.checklist || []).length) set.checklist = gov.CHECKLIST.map((text) => ({ text, done: false }));
    }
    const doc = await HqGovListing.findByIdAndUpdate(l._id, { $set: set }, { new: true }).lean();
    res.json(shape(doc));
  } catch (err) {
    next(err);
  }
};

/** DELETE /hq/gov/:id: only ones you added by hand (feed ones are marked "Not for us", so they don't come back). */
exports.remove = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return fail(res, 404, "That listing is gone");
    const l = await HqGovListing.findById(req.params.id).select("source").lean();
    if (!l) return fail(res, 404, "That listing is gone");
    if (l.source === "sam") return fail(res, 400, "Mark it \"Not for us\" instead, so the feed doesn't add it again.");
    await HqGovListing.deleteOne({ _id: l._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/** POST /hq/gov/refresh: pull from SAM.gov now. */
exports.refresh = async (req, res, next) => {
  try {
    const r = await sam.fetchNew();
    res.status(r.ok ? 200 : 400).json({ ...r, ...(r.ok ? {} : { message: r.error }), feed: await feedState() });
  } catch (err) {
    next(err);
  }
};

/** Deadlines for This week; never fails the page. */
exports.deadlines = async (now = new Date(), tz) => {
  try {
    const listings = await HqGovListing.find({ status: { $in: ["reviewing", "bidding"] } }).select("title agency url status dueAt questionsDueAt checklist").lean();
    return gov.deadlineTodos(listings, { now, tz });
  } catch {
    return [];
  }
};
