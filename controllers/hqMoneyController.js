/**
 * HQ Money: a simple P&L. Income comes from Stripe (read only: balance
 * transactions and subscriptions, never a charge or a change); expenses
 * are what we pay for, imported from the expense sheet and kept here.
 * A management view, not accounting.
 */
const mongoose = require("mongoose");
const Stripe = require("stripe");
const { parse } = require("csv-parse/sync");
const HqExpense = require("../models/hqExpenseModel");
const money = require("../utils/hq/money");

const fail = (res, status, message) => res.status(status).json({ message });
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// HQ_STRIPE_KEY lets you give HQ a restricted, read-only key; otherwise the app's key is used for reads only.
const stripeKey = () => process.env.HQ_STRIPE_KEY || process.env.STRIPE_SECRET_KEY || "";
let client = null;
let clientKey = "";
function stripe() {
  const key = stripeKey();
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = Stripe(key);
    clientKey = key;
  }
  return client;
}

const cache = new Map(); // year → { at, data }
const TEN_MIN = 10 * 60 * 1000;

/** Everything Stripe says about the year, read only, kept for 10 minutes. */
async function stripeYear(year, refresh) {
  const s = stripe();
  if (!s) return { configured: false };
  const hit = cache.get(year);
  if (!refresh && hit && Date.now() - hit.at < TEN_MIN) return hit.data;
  const from = Math.floor(Date.UTC(year, 0, 1) / 1000);
  const to = Math.floor(Date.UTC(year + 1, 0, 1) / 1000);
  try {
    const [txs, subs, products] = await Promise.all([
      s.balanceTransactions.list({ created: { gte: from, lt: to }, limit: 100 }).autoPagingToArray({ limit: 10000 }),
      s.subscriptions.list({ status: "all", limit: 100, expand: ["data.customer"] }).autoPagingToArray({ limit: 2000 }),
      s.products.list({ limit: 100 }).autoPagingToArray({ limit: 500 }),
    ]);
    const names = Object.fromEntries(products.map((p) => [p.id, p.name]));
    for (const sub of subs) for (const it of sub.items?.data || []) if (it.price && typeof it.price.product === "string") it.price.product = { id: it.price.product, name: names[it.price.product] || "" };
    const data = { configured: true, live: !stripeKey().startsWith("sk_test") && !stripeKey().startsWith("rk_test"), income: money.incomeByMonth(txs, year), subs: money.subscriptionSummary(subs, year), at: new Date() };
    cache.set(year, { at: Date.now(), data });
    return data;
  } catch (e) {
    return { configured: true, error: e?.message || "Stripe didn't answer." };
  }
}

const plain = (e) => ({ ...e, _id: String(e._id), months: e.months instanceof Map ? Object.fromEntries(e.months) : e.months || {} });

/** GET /hq/money?year= : the P&L by month, MRR, customers and expenses. */
exports.getMoney = async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year) || now.getUTCFullYear();
    const [expenses, st] = await Promise.all([HqExpense.find().sort({ category: 1, name: 1 }).lean(), stripeYear(year, req.query.refresh === "1")]);
    const list = expenses.map(plain);
    const pl = money.profitAndLoss({ year, income: st.income, expenses: list, now });
    const thisMonth = pl.months.find((m) => m.current) || pl.months[pl.months.length - 1];
    const usualMonthly = list.reduce((a, e) => a + (e.cadence === "monthly" && (!e.endMonth || e.endMonth >= thisMonth.month) ? Number(e.amount) || 0 : e.cadence === "yearly" ? (Number(e.amount) || 0) / 12 : 0), 0);
    const mrr = st.subs?.mrr || 0;
    const avgPrice = st.subs?.paying ? mrr / st.subs.paying : null;
    res.json({
      year,
      months: pl.months.map((m) => ({ ...m, ...(st.subs?.byMonth?.[m.month] || { started: 0, canceled: 0 }) })),
      totals: pl.totals,
      mrr,
      arr: Math.round(mrr * 12 * 100) / 100,
      paying: st.subs?.paying || 0,
      trialing: st.subs?.trialing || 0,
      subscriptions: st.subs?.list || [],
      expenses: list,
      burn: Math.round(usualMonthly * 100) / 100, // what we usually spend a month now
      breakEven: avgPrice ? Math.max(0, Math.ceil((usualMonthly - mrr) / avgPrice)) : null, // more paying customers needed to cover it
      stripe: { configured: Boolean(st.configured), live: st.live ?? null, error: st.error || null, at: st.at || null },
    });
  } catch (e) {
    console.error("[hq money]", e);
    fail(res, 500, "Couldn't load the money page.");
  }
};

function clean(b) {
  const out = {};
  if (b.name !== undefined) out.name = String(b.name || "").trim().slice(0, 120);
  if (b.category !== undefined) out.category = String(b.category || "").trim().slice(0, 60);
  if (b.cadence !== undefined) out.cadence = ["monthly", "yearly", "one_time"].includes(b.cadence) ? b.cadence : "monthly";
  if (b.amount !== undefined) out.amount = Math.max(0, Math.round((money.money(b.amount) || 0) * 100) / 100);
  for (const k of ["startMonth", "endMonth"]) if (b[k] !== undefined) out[k] = MONTH.test(String(b[k] || "")) ? b[k] : "";
  if (b.notes !== undefined) out.notes = String(b.notes || "").slice(0, 2000);
  return out;
}

/** POST /hq/money/expenses */
exports.createExpense = async (req, res) => {
  const body = clean(req.body || {});
  if (!body.name) return fail(res, 400, "Give it a name.");
  const doc = await HqExpense.create(body);
  res.status(201).json(plain(doc.toObject()));
};

/**
 * PATCH /hq/money/expenses/:id : change the usual cost, or one month's
 * actual cost with { month: "2026-03", cost: 32 } (cost null = back to usual).
 */
exports.updateExpense = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found.");
  const b = req.body || {};
  const update = { $set: clean(b) };
  if (b.month !== undefined) {
    if (!MONTH.test(String(b.month))) return fail(res, 400, "Month looks like 2026-03.");
    const v = b.cost === null || b.cost === "" ? null : money.money(b.cost);
    if (v === null) update.$unset = { [`months.${b.month}`]: 1 };
    else update.$set[`months.${b.month}`] = Math.max(0, Math.round(v * 100) / 100);
  }
  if (update.$set.name === "") return fail(res, 400, "Give it a name.");
  const doc = await HqExpense.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
  if (!doc) return fail(res, 404, "Not found.");
  res.json(plain(doc));
};

/** DELETE /hq/money/expenses/:id */
exports.deleteExpense = async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, "Not found.");
  await HqExpense.deleteOne({ _id: req.params.id });
  res.json({ ok: true });
};

/**
 * POST /hq/money/import { url | csv, year } : read the expense sheet (a
 * Google Sheets link anyone with the link can view, or pasted CSV) and add
 * or update each service by name. Months in the sheet replace what's here.
 */
exports.importSheet = async (req, res) => {
  const year = Number(req.body?.year) || new Date().getUTCFullYear();
  let text = String(req.body?.csv || "");
  if (!text && req.body?.url) {
    const url = money.sheetCsvUrl(req.body.url);
    if (!url) return fail(res, 400, "That isn't a Google Sheets link.");
    try {
      const r = await fetch(url, { redirect: "follow" });
      text = await r.text();
      if (!r.ok || /^\s*<(!doctype|html)/i.test(text)) return fail(res, 400, "Couldn't open the sheet. In Google Sheets, Share → General access → Anyone with the link can view, then try again.");
    } catch {
      return fail(res, 502, "Couldn't reach Google Sheets. Try again, or paste the CSV.");
    }
  }
  if (!text.trim()) return fail(res, 400, "Paste a Google Sheets link or the CSV.");
  let rows;
  try {
    rows = parse(text, { relax_column_count: true, skip_empty_lines: false, bom: true });
    rows = money.parseExpenseSheet(rows, year);
  } catch (e) {
    return fail(res, 400, e.message || "Couldn't read that sheet.");
  }
  let added = 0;
  let updated = 0;
  for (const r of rows) {
    const existing = await HqExpense.findOne({ name: new RegExp(`^${r.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
    const set = { category: r.category, cadence: r.cadence, amount: r.amount };
    for (const [k, v] of Object.entries(r.months)) set[`months.${k}`] = v;
    if (existing) {
      if (!existing.startMonth && r.startMonth) set.startMonth = r.startMonth;
      await HqExpense.updateOne({ _id: existing._id }, { $set: set });
      updated += 1;
    } else {
      await HqExpense.create({ name: r.name, category: r.category, cadence: r.cadence, amount: r.amount, startMonth: r.startMonth, months: r.months });
      added += 1;
    }
  }
  res.json({ added, updated, services: rows.map((r) => r.name) });
};

exports._test = { stripeYear, clean, cache };
