/**
 * HQ email (Klaviyo): who we email, who really clicks, how Klaviyo's list
 * lines up with the CRM (it isn't one-to-one), and stopping email to people
 * we don't want to keep emailing.
 */
const HqEmailSignal = require("../models/hqEmailSignalModel");
const HqContact = require("../models/hqContactModel");
const HqSync = require("../models/hqSyncModel");
const klaviyo = require("../utils/hq/klaviyo");

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const by = (req) => req.hqUser?.name || req.hqUser?.email || "";

const REASONS = {
  bots: "Only email-scanner clicks",
  not_interested: "Not interested",
  bad_reply: "Asked us to stop / bad reply",
  wrong_person: "Wrong person or left the job",
  bounced: "Bounced / bad address",
  other: "Other",
};

// The groups on the Email page. Klaviyo-side views filter HqEmailSignal; "crmOnly" lists CRM people Klaviyo never emailed.
const SIGNAL_VIEWS = {
  all: {},
  real: { humanClicks: { $gt: 0 } },
  scannerOnly: { humanClicks: 0, botClicks: { $gt: 0 } },
  noClicks: { humanClicks: 0, botClicks: 0 },
  unsubscribed: { unsubscribed: true },
  suppressed: { suppressed: true },
};

async function crmEmails() {
  return new Set((await HqContact.find({ email: { $nin: ["", null] } }).select("email").lean()).map((c) => c.email));
}

exports.getEmail = async (req, res, next) => {
  try {
    const view = String(req.query.view || "real");
    const q = String(req.query.q || "").trim();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const page = Math.max(1, Number(req.query.page) || 1);

    const [totals, sync, crm, signalEmails] = await Promise.all([
      HqEmailSignal.aggregate([{ $group: { _id: null, people: { $sum: 1 }, delivered: { $sum: "$delivered" }, human: { $sum: "$humanClicks" }, bot: { $sum: "$botClicks" } } }]),
      HqSync.findOne({ key: "klaviyo" }).select("lastOkAt lastRunAt error").lean(),
      crmEmails(),
      HqEmailSignal.distinct("email"),
    ]);
    const inKlaviyo = new Set(signalEmails);
    const both = signalEmails.filter((e) => crm.has(e)).length;
    const coverage = { klaviyo: inKlaviyo.size, crm: crm.size, both, klaviyoOnly: inKlaviyo.size - both, crmOnly: crm.size - both };

    const counts = {};
    for (const [k, f] of Object.entries(SIGNAL_VIEWS)) counts[k] = await HqEmailSignal.countDocuments(f);
    counts.klaviyoOnly = coverage.klaviyoOnly;
    counts.crmOnly = coverage.crmOnly;

    let rows;
    let total;
    if (view === "crmOnly") {
      const filter = { email: { $nin: ["", null, ...signalEmails] } };
      if (q) filter.$or = [{ email: new RegExp(escapeRe(q), "i") }, { name: new RegExp(escapeRe(q), "i") }, { group: new RegExp(escapeRe(q), "i") }];
      total = await HqContact.countDocuments(filter);
      const contacts = await HqContact.find(filter).select("name title role email group facilityId facilityName").sort({ group: 1, name: 1 }).skip((page - 1) * limit).limit(limit).lean();
      rows = contacts.map((c) => ({ email: c.email, contact: c, inCrm: true, inKlaviyo: false }));
    } else {
      const filter = view === "klaviyoOnly" ? { email: { $nin: [...crm] } } : { ...(SIGNAL_VIEWS[view] || SIGNAL_VIEWS.real) };
      if (q) filter.email = { ...(filter.email || {}), $regex: escapeRe(q), $options: "i" };
      total = await HqEmailSignal.countDocuments(filter);
      const signals = await HqEmailSignal.find(filter).sort({ humanClicks: -1, lastHumanClickAt: -1, botClicks: -1, email: 1 }).skip((page - 1) * limit).limit(limit).lean();
      const contacts = await HqContact.find({ email: { $in: signals.map((s) => s.email) } }).select("name title role email group facilityId facilityName").lean();
      const cBy = new Map(contacts.map((c) => [c.email, c]));
      rows = signals.map((s) => ({ ...s, contact: cBy.get(s.email) || null, inCrm: crm.has(s.email), inKlaviyo: true }));
    }

    res.json({
      configured: klaviyo.isConfigured(),
      sync,
      totals: totals[0] ? { ...totals[0], _id: undefined } : { people: 0, delivered: 0, human: 0, bot: 0 },
      coverage,
      counts,
      reasons: REASONS,
      view,
      total,
      page,
      limit,
      rows,
    });
  } catch (err) {
    next(err);
  }
};

/** Stop emailing these addresses in Klaviyo (suppress), and remember why. */
exports.suppress = async (req, res, next) => {
  try {
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 1000);
    const reason = REASONS[req.body?.reason] ? req.body.reason : "other";
    if (!emails.length) return res.status(400).json({ message: "Pick at least one person" });
    if (!klaviyo.isConfigured()) return res.status(400).json({ message: "Klaviyo isn't connected yet (KLAVIYO_PRIVATE_KEY)." });
    try {
      await klaviyo.setSuppressed(emails, true);
    } catch (err) {
      return res.status(502).json({ message: `Klaviyo: ${klaviyo.errText(err)}` });
    }
    await HqEmailSignal.bulkWrite(
      emails.map((email) => ({
        updateOne: {
          filter: { email },
          update: { $set: { suppressed: true, suppressedAt: new Date(), suppressReason: reason, suppressedBy: by(req) }, $setOnInsert: { email } },
          upsert: true,
        },
      })),
    );
    res.json({ ok: true, count: emails.length });
  } catch (err) {
    next(err);
  }
};

/** Start emailing them again (undo). */
exports.unsuppress = async (req, res, next) => {
  try {
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean).slice(0, 1000);
    if (!emails.length) return res.status(400).json({ message: "Pick at least one person" });
    if (!klaviyo.isConfigured()) return res.status(400).json({ message: "Klaviyo isn't connected yet (KLAVIYO_PRIVATE_KEY)." });
    try {
      await klaviyo.setSuppressed(emails, false);
    } catch (err) {
      return res.status(502).json({ message: `Klaviyo: ${klaviyo.errText(err)}` });
    }
    await HqEmailSignal.updateMany({ email: { $in: emails } }, { $set: { suppressed: false, suppressedAt: null, suppressReason: "", suppressedBy: "" } });
    res.json({ ok: true, count: emails.length });
  } catch (err) {
    next(err);
  }
};

/** Add Klaviyo-only addresses to the CRM as people (so they can be worked). */
exports.addToCrm = async (req, res, next) => {
  try {
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 500);
    if (!emails.length) return res.status(400).json({ message: "Pick at least one person" });
    const r = await HqContact.bulkWrite(
      emails.map((email) => ({ updateOne: { filter: { email }, update: { $setOnInsert: { email, source: "manual", role: "other", notes: "Added from Klaviyo" } }, upsert: true } })),
    );
    res.json({ ok: true, added: r.upsertedCount || 0 });
  } catch (err) {
    next(err);
  }
};

module.exports.REASONS = REASONS;
