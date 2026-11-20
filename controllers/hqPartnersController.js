/**
 * HQ referral partners: anyone owners trust who introduces clients. No
 * accounts for them; each gets a code (their Stripe promotion code). The
 * workspaces that signed up with it, what they've paid (read from Stripe,
 * never changed) and the fees due are worked out fresh. Calls and emails
 * logged here count toward the Referral partners campaign.
 */
const mongoose = require("mongoose");
const HqPartner = require("../models/hqPartnerModel");
const HqActivity = require("../models/hqActivityModel");
const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
const Tenant = require("../models/tenantModel");
const { stripeClient } = require("./hqMoneyController");
const { cleanCode, couponWords } = require("../utils/referrals");
const P = require("../utils/hq/partners");

const fail = (res, status, message) => res.status(status).json({ message });
const isId = (v) => mongoose.isValidObjectId(String(v || ""));
const by = (req) => req.hqUser?.name || req.hqUser?.email || "";
const PLAY_KEY = "referral-partners";
const FIELDS = ["name", "contactName", "type", "email", "phone", "website", "area", "notes", "nextDate"];
const signupLink = (code) => `${(process.env.FRONTEND_URL || "https://wisershifts.com").replace(/\/$/, "")}/signup-tenant?code=${encodeURIComponent(code)}`;

// Stripe reads are kept 10 minutes: paid invoices per customer, and each code's promotion.
const TEN_MIN = 10 * 60 * 1000;
const cache = new Map();
async function cached(key, refresh, fn) {
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < TEN_MIN) return hit.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  return v;
}

/** Is the code set up in Stripe, and what does it give? */
async function stripeCode(code, refresh) {
  const s = stripeClient();
  if (!s || !code) return null;
  return cached(`code:${code}`, refresh, async () => {
    try {
      const { data } = await s.promotionCodes.list({ code, limit: 1, expand: ["data.coupon"] });
      const p = data?.[0];
      if (!p) return { found: false };
      const coupon = p.coupon || p.promotion?.coupon || null;
      return { found: true, active: Boolean(p.active), offer: couponWords(typeof coupon === "object" ? coupon : null), timesRedeemed: p.times_redeemed || 0 };
    } catch (e) {
      return { found: false, error: "Couldn't check Stripe." };
    }
  });
}

/** What a customer has paid, from their Stripe invoices. */
async function paidFor(customerId, refresh) {
  const s = stripeClient();
  if (!s || !customerId) return { months: 0, firstPaidAt: null, total: 0, payments: [] };
  return cached(`paid:${customerId}`, refresh, async () => {
    try {
      const invoices = await s.invoices.list({ customer: customerId, status: "paid", limit: 100 }).autoPagingToArray({ limit: 200 });
      return P.paidMonths(invoices);
    } catch {
      return { months: 0, firstPaidAt: null, total: 0, payments: [], error: true };
    }
  });
}

async function shape(partner, refresh) {
  const tenants = partner.code
    ? await Tenant.find({ referralCode: partner.code }).select("name createdAt plan subscriptionStatus stripeCustomerId referralRedeemedAt").lean()
    : [];
  const paid = new Map();
  for (const t of tenants) paid.set(String(t._id), await paidFor(t.stripeCustomerId, refresh));
  const referrals = P.referralRows(partner, tenants, paid);
  return {
    ...partner,
    _id: String(partner._id),
    typeLabel: P.TYPES[partner.type] || "Other",
    deal: P.dealWords(partner),
    dealHistory: [...(partner.dealHistory || [])].sort((a, b) => new Date(b.at) - new Date(a.at)),
    statusLabel: P.STATUSES[partner.status] || partner.status,
    link: partner.code ? signupLink(partner.code) : "",
    stripe: await stripeCode(partner.code, refresh),
    referrals,
    totals: P.totals(referrals),
    log: [...(partner.log || [])].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100),
  };
}

const play = () => HqPlaybookPlay.findOne({ seedKey: PLAY_KEY }).select("_id title scripts weeklyTarget").lean();

/** GET /hq/partners: every partner (fees due first), the campaign's scripts, and totals. */
exports.list = async (req, res, next) => {
  try {
    const refresh = req.query.refresh === "1";
    const partners = await HqPartner.find({}).lean();
    const out = [];
    for (const p of partners) out.push(await shape(p, refresh));
    const order = { active: 0, agreed: 1, call: 2, contacted: 3, new: 4, quiet: 5 };
    out.sort((a, b) => b.totals.feesDue - a.totals.feesDue || order[a.status] - order[b.status] || a.name.localeCompare(b.name));
    const pl = await play();
    res.json({
      partners: out,
      types: P.TYPES,
      statuses: P.STATUSES,
      monthsForFee: P.MONTHS_FOR_FEE,
      stripeConfigured: Boolean(stripeClient()),
      play: pl ? { _id: String(pl._id), title: pl.title, scripts: pl.scripts || [], weeklyTarget: pl.weeklyTarget } : null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * The deal: flat fee, or percent for a number of months. Any change is
 * recorded (from, to, who, when), since partners renegotiate.
 */
function applyDeal(p, b, who) {
  if (!["dealType", "fee", "percent", "percentMonths", "dealNote"].some((k) => b[k] !== undefined)) return null;
  const before = P.dealWords(p);
  const beforeNote = p.dealNote || "";
  if (b.dealType !== undefined) p.dealType = b.dealType === "percent" ? "percent" : "flat";
  if (b.fee !== undefined) {
    const fee = Number(b.fee);
    if (!Number.isFinite(fee) || fee < 0 || fee > 10000) return "The flat fee should be between $0 and $10,000.";
    p.fee = Math.round(fee * 100) / 100;
  }
  if (b.percent !== undefined) {
    const pct = Number(b.percent);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 50) return "The percentage should be between 1 and 50.";
    p.percent = Math.round(pct * 10) / 10;
  }
  if (b.percentMonths !== undefined) {
    const m = Math.round(Number(b.percentMonths));
    if (!Number.isFinite(m) || m < 1 || m > 60) return "The number of months should be between 1 and 60.";
    p.percentMonths = m;
  }
  if (b.dealNote !== undefined) p.dealNote = String(b.dealNote || "").trim().slice(0, 500);
  const after = P.dealWords(p);
  if (after !== before || (p.dealNote || "") !== beforeNote) {
    p.dealHistory = [...(p.dealHistory || []), { at: new Date(), by: who, from: before + (beforeNote ? ` (${beforeNote})` : ""), to: after + (p.dealNote ? ` (${p.dealNote})` : "") }];
  }
  return null;
}

/** Check and set fields from the body; returns an error message or null. */
async function apply(p, b, who = "") {
  const dealError = applyDeal(p, b, who);
  if (dealError) return dealError;
  for (const k of FIELDS) {
    if (b[k] === undefined) continue;
    if (k === "nextDate") p.nextDate = b.nextDate && !Number.isNaN(new Date(b.nextDate).getTime()) ? new Date(b.nextDate) : null;
    else if (k === "type") p.type = P.TYPES[b.type] ? b.type : "other";
    else p[k] = String(b[k] || "").trim().slice(0, k === "notes" ? 8000 : 200);
  }
  if (!String(p.name || "").trim()) return "Give the partner a name.";
  if (b.code !== undefined) {
    const code = cleanCode(b.code);
    if (code) {
      const other = await HqPartner.findOne({ code, _id: { $ne: p._id } }).select("name").lean();
      if (other) return `${other.name} already has the code ${code}.`;
    }
    p.code = code;
  }
  if (b.status !== undefined && P.STATUSES[b.status] && b.status !== p.status) {
    p.status = b.status;
    p.statusAt = new Date();
  }
  return null;
}

/** POST /hq/partners */
exports.create = async (req, res, next) => {
  try {
    const p = new HqPartner({});
    const error = await apply(p, req.body || {}, by(req));
    if (error) return fail(res, 400, error);
    await p.save();
    res.status(201).json(await shape(p.toObject()));
  } catch (err) {
    next(err);
  }
};

async function find(req, res) {
  const p = isId(req.params.id) ? await HqPartner.findById(req.params.id) : null;
  if (!p) fail(res, 404, "That partner is gone");
  return p;
}

/** PATCH /hq/partners/:id */
exports.update = async (req, res, next) => {
  try {
    const p = await find(req, res);
    if (!p) return;
    const error = await apply(p, req.body || {}, by(req));
    if (error) return fail(res, 400, error);
    await p.save();
    res.json(await shape(p.toObject()));
  } catch (err) {
    next(err);
  }
};

/** DELETE /hq/partners/:id (their workspaces keep the code; only the partner goes). */
exports.remove = async (req, res, next) => {
  try {
    const p = await find(req, res);
    if (!p) return;
    await HqPartner.deleteOne({ _id: p._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /hq/partners/:id/log { kind, text }
 * Calls, emails and meetings also count toward the Referral partners campaign.
 * Logging the first touch with a new partner moves them to Contacted.
 */
exports.log = async (req, res, next) => {
  try {
    const p = await find(req, res);
    if (!p) return;
    const b = req.body || {};
    const kind = ["call", "email", "meeting", "text", "note"].includes(b.kind) ? b.kind : "note";
    const text = String(b.text || "").trim().slice(0, 4000);
    if (!text && kind === "note") return fail(res, 400, "Write what happened.");
    const at = new Date();
    p.log.push({ at, kind, text, by: by(req) });
    if (kind !== "note" && p.status === "new") {
      p.status = "contacted";
      p.statusAt = at;
    }
    await p.save();
    if (["call", "email", "meeting"].includes(kind)) {
      const pl = await play();
      await HqActivity.create({ kind, playId: pl?._id || null, outcome: p.name, notes: text, at, by: by(req) });
    }
    res.json(await shape(p.toObject()));
  } catch (err) {
    next(err);
  }
};

/** DELETE /hq/partners/:id/log/:entryId */
exports.removeLog = async (req, res, next) => {
  try {
    const p = await find(req, res);
    if (!p) return;
    p.log = p.log.filter((e) => String(e._id) !== String(req.params.entryId));
    await p.save();
    res.json(await shape(p.toObject()));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /hq/partners/:id/fees { tenantId, amount } : record a payout to the
 * partner for one client (amount defaults to what's owed now).
 * { tenantId, paid: false } takes back the most recent payout.
 */
exports.fee = async (req, res, next) => {
  try {
    const p = await find(req, res);
    if (!p) return;
    const tenantId = String(req.body?.tenantId || "");
    if (!isId(tenantId)) return fail(res, 400, "Which workspace?");
    const mine = (p.feesPaid || []).filter((f) => String(f.tenantId) === tenantId);
    if (req.body?.paid === false) {
      const last = mine.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))[0];
      if (last) p.feesPaid = p.feesPaid.filter((f) => f !== last);
    } else {
      let amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        const row = (await shape(p.toObject())).referrals.find((r) => r.tenantId === tenantId);
        amount = row?.owed || 0;
      }
      if (!(amount > 0)) return fail(res, 400, "Nothing is owed for this client right now.");
      p.feesPaid.push({ tenantId, paidAt: new Date(), amount: Math.round(amount * 100) / 100, by: by(req) });
    }
    await p.save();
    res.json(await shape(p.toObject()));
  } catch (err) {
    next(err);
  }
};

exports._test = { shape, apply, cache };
