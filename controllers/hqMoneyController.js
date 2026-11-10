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
const Tenant = require("../models/tenantModel");
const HqMoneyHidden = require("../models/hqMoneyHiddenModel");
const HqMoneyNudge = require("../models/hqMoneyNudgeModel");
const nudge = require("../utils/hq/nudge");
const { sendEmail } = require("../utils/sendEmail");
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
    const [txs, allSubs, products, tenants] = await Promise.all([
      s.balanceTransactions.list({ created: { gte: from, lt: to }, limit: 100, expand: ["data.source"] }).autoPagingToArray({ limit: 10000 }),
      s.subscriptions.list({ status: "all", limit: 100, expand: ["data.customer"] }).autoPagingToArray({ limit: 2000 }),
      s.products.list({ limit: 100 }).autoPagingToArray({ limit: 500 }),
      Tenant.find({ $or: [{ stripeCustomerId: { $ne: null } }, { stripeSubscriptionId: { $ne: null } }] }).select("stripeCustomerId stripeSubscriptionId").lean(),
    ]);
    const hidden = await HqMoneyHidden.find().lean();
    // Only WiserShifts' own subscriptions and customers count, less the ones hidden as tests.
    const { subs, customers, hiddenSubs } = money.wiserShifts({ subs: allSubs, tenants, hidden: hidden.map((h) => h.customerId) });
    const names = Object.fromEntries(products.map((p) => [p.id, p.name]));
    for (const sub of subs) for (const it of sub.items?.data || []) if (it.price && typeof it.price.product === "string") it.price.product = { id: it.price.product, name: names[it.price.product] || "" };

    // Whose money each transaction is: a payment's customer, or for a refund, the customer of the payment it refunds.
    const chargeCustomer = new Map();
    for (const t of txs) if (t.source?.object === "charge") chargeCustomer.set(t.source.id, money.customerId(t.source.customer));
    const missing = [...new Set(txs.filter((t) => t.source?.object === "refund").map((t) => money.customerId(t.source.charge)).filter((id) => id && !chargeCustomer.has(id)))];
    for (const id of missing.slice(0, 100)) {
      try {
        const c = await s.charges.retrieve(id);
        chargeCustomer.set(id, money.customerId(c.customer));
      } catch {
        chargeCustomer.set(id, null);
      }
    }
    const ownerOf = (t) => {
      if (t.source?.object === "charge") return chargeCustomer.get(t.source.id);
      if (t.source?.object === "refund") return chargeCustomer.get(money.customerId(t.source.charge));
      return null; // account-level fees and anything else can't be tied to WiserShifts
    };
    const ours = (t) => customers.has(ownerOf(t));
    const income = money.incomeByMonth(txs, year, ours);

    // Read only, and each on its own: a restricted key without Balance, Payouts or Invoices read still loads the rest.
    const soft = (fn) => Promise.resolve().then(fn).catch(() => null);
    const [balance, payouts, invoices] = await Promise.all([
      soft(() => s.balance.retrieve()),
      soft(() => s.payouts.list({ created: { gte: from, lt: to }, limit: 100 }).autoPagingToArray({ limit: 1000 })),
      soft(() => s.invoices.list({ created: { gte: from - 90 * 86400 }, limit: 100 }).autoPagingToArray({ limit: 3000 })),
    ]);
    const cash = money.cashSummary({ txs, keep: ours, balance, payouts });
    const timing = invoices ? money.paymentTiming(invoices.filter((inv) => customers.has(money.customerId(inv.customer)))) : null;
    const data = {
      configured: true,
      live: !stripeKey().startsWith("sk_test") && !stripeKey().startsWith("rk_test"),
      income,
      left: { ...income.left, subscriptions: allSubs.length - subs.length },
      subs: money.subscriptionSummary(subs, year),
      cash,
      timing,
      hidden: hidden.map((h) => ({ customerId: h.customerId, label: h.label, subscriptions: hiddenSubs.filter((x) => money.customerId(x.customer) === h.customerId).length })),
      at: new Date(),
    };
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
    const subIds = (st.subs?.list || []).filter((x) => x.status === "past_due" || x.status === "unpaid").map((x) => x.id);
    const nudges = subIds.length ? await HqMoneyNudge.find({ subscriptionId: { $in: subIds }, test: false }).sort({ createdAt: -1 }).lean() : [];
    const lastNudge = {};
    for (const n of nudges) if (!lastNudge[n.subscriptionId]) lastNudge[n.subscriptionId] = { at: n.createdAt, to: n.to, by: n.by };
    const pl = money.profitAndLoss({ year, income: st.income, expenses: list, now });
    const thisMonth = pl.months.find((m) => m.current) || pl.months[pl.months.length - 1];
    const usualMonthly = list.reduce((a, e) => a + (e.cadence === "monthly" && (!e.endMonth || e.endMonth >= thisMonth.month) ? Number(e.amount) || 0 : e.cadence === "yearly" ? (Number(e.amount) || 0) / 12 : 0), 0);
    const mrr = st.subs?.mrr || 0;
    // Break even at the average real plan (paid-up ones first, else any not canceled); test-sized ones under $1 don't count.
    const real = (st.subs?.list || []).filter((x) => x.monthly >= 1 && x.status !== "canceled");
    const priced = real.some((x) => x.status === "active") ? real.filter((x) => x.status === "active") : real;
    const avgPrice = priced.length ? priced.reduce((a, x) => a + x.monthly, 0) / priced.length : null;
    res.json({
      year,
      months: pl.months.map((m) => ({ ...m, ...(st.subs?.byMonth?.[m.month] || { started: 0, canceled: 0 }) })),
      totals: pl.totals,
      mrr,
      arr: Math.round(mrr * 12 * 100) / 100,
      paying: st.subs?.paying || 0,
      trialing: st.subs?.trialing || 0,
      failing: st.subs?.failing || 0,
      atRisk: st.subs?.atRisk || 0,
      hidden: st.hidden || [],
      subscriptions: (st.subs?.list || []).map((x) => ({ ...x, ...(lastNudge[x.id] ? { lastNudge: lastNudge[x.id] } : {}), ...(st.timing ? { payments: st.timing[x.id] || { lastPaid: null, open: null, latePaid: 0, paidCount: 0 } } : {}) })),
      cash: st.cash || null,
      overdue: st.timing ? Object.values(st.timing).filter((t) => t.open && t.open.daysOverdue > 0).length : null,
      expenses: list,
      burn: Math.round(usualMonthly * 100) / 100, // what we usually spend a month now
      covered: mrr > 0 && mrr >= usualMonthly,
      breakEven: avgPrice ? Math.max(0, Math.ceil((usualMonthly - mrr) / avgPrice)) : null, // more paying customers needed to cover it
      stripe: { configured: Boolean(st.configured), live: st.live ?? null, error: st.error || null, at: st.at || null, left: st.left || null },
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

/** POST /hq/money/hide { customerId, hidden, label } : leave a customer (a test checkout) out of Money, or bring them back. */
exports.hideCustomer = async (req, res) => {
  const id = String(req.body?.customerId || "");
  if (!/^cus_[A-Za-z0-9]+$/.test(id)) return fail(res, 400, "That isn't a Stripe customer.");
  if (req.body?.hidden === false) await HqMoneyHidden.deleteOne({ customerId: id });
  else await HqMoneyHidden.updateOne({ customerId: id }, { $set: { label: String(req.body?.label || "").slice(0, 200) } }, { upsert: true });
  cache.clear();
  res.json({ ok: true });
};

/** The unpaid invoice behind a failing subscription, with who to email. Read only. */
async function failedInvoice(subscriptionId) {
  const s = stripe();
  if (!s) throw Object.assign(new Error("Stripe isn't connected."), { status: 400 });
  if (!/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) throw Object.assign(new Error("That isn't a subscription."), { status: 400 });
  const sub = await s.subscriptions.retrieve(subscriptionId, { expand: ["customer"] });
  if (!sub.metadata?.tenantId) {
    const tenant = await Tenant.exists({ $or: [{ stripeSubscriptionId: sub.id }, { stripeCustomerId: money.customerId(sub.customer) }] });
    if (!tenant) throw Object.assign(new Error("That isn't a WiserShifts subscription."), { status: 400 });
  }
  const { data } = await s.invoices.list({ subscription: sub.id, status: "open", limit: 1 });
  const inv = data[0];
  if (!inv) throw Object.assign(new Error("There's no unpaid invoice on this subscription right now."), { status: 404 });
  const c = typeof sub.customer === "object" ? sub.customer : {};
  const price = sub.items?.data?.[0]?.price || {};
  let plan = price.nickname || "";
  if (!plan && typeof price.product === "string") plan = (await s.products.retrieve(price.product).catch(() => null))?.name || "";
  return {
    sub,
    invoice: inv,
    customer: c.name || "",
    to: inv.customer_email || c.email || "",
    plan,
    amountDue: inv.amount_due,
    payUrl: inv.hosted_invoice_url,
  };
}

const sender = (req) => ({ sender: req.hqUser?.name || "", senderEmail: req.hqUser?.email || "" });

/** GET /hq/money/nudge/:subscriptionId : the failed invoice, who it goes to, and a draft email. */
exports.previewNudge = async (req, res) => {
  try {
    const f = await failedInvoice(req.params.subscriptionId);
    const history = await HqMoneyNudge.find({ subscriptionId: f.sub.id }).sort({ createdAt: -1 }).limit(10).lean();
    res.json({
      to: f.to,
      customer: f.customer,
      plan: f.plan,
      amountDue: f.amountDue / 100,
      invoiceNumber: f.invoice.number || "",
      payUrl: f.payUrl,
      attempts: f.invoice.attempt_count || 0,
      nextTry: f.invoice.next_payment_attempt ? new Date(f.invoice.next_payment_attempt * 1000) : null,
      testTo: req.hqUser?.email || "",
      draft: nudge.draftNudge({ customer: f.customer, plan: f.plan, amountDue: f.amountDue, ...sender(req) }),
      history: history.map((h) => ({ at: h.createdAt, to: h.to, test: h.test, by: h.by })),
    });
  } catch (e) {
    fail(res, e.status || 502, e.status ? e.message : `Stripe didn't answer: ${e.message}`);
  }
};

/**
 * POST /hq/money/nudge/:subscriptionId { subject, message, test } : email the
 * pay link. test: true sends it only to you, marked as a test.
 */
exports.sendNudge = async (req, res) => {
  const test = req.body?.test !== false;
  const subject = String(req.body?.subject || "").trim().slice(0, 200);
  const message = String(req.body?.message || "").trim().slice(0, 5000);
  if (!subject || !message) return fail(res, 400, "Write a subject and a message.");
  let f;
  try {
    f = await failedInvoice(req.params.subscriptionId);
  } catch (e) {
    return fail(res, e.status || 502, e.status ? e.message : `Stripe didn't answer: ${e.message}`);
  }
  if (!f.payUrl) return fail(res, 400, "Stripe has no pay link for this invoice.");
  const to = test ? req.hqUser?.email : f.to;
  if (!to) return fail(res, 400, test ? "Your HQ account has no email." : "This customer has no email in Stripe.");
  try {
    await sendEmail(to, test ? `[Test] ${subject}` : subject, nudge.nudgeHtml({ message, payUrl: f.payUrl, amountDue: f.amountDue }), nudge.nudgeText({ message, payUrl: f.payUrl }));
  } catch (e) {
    return fail(res, 502, `The email didn't send: ${e.message}`);
  }
  await HqMoneyNudge.create({ subscriptionId: f.sub.id, invoiceId: f.invoice.id, to, subject, test, by: req.hqUser?.name || req.hqUser?.email || "" });
  res.json({ ok: true, to, test });
};

exports._test = { stripeYear, clean, cache };
