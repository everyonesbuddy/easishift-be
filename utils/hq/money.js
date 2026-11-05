/**
 * HQ Money, as pure functions: read the expense sheet, work out what each
 * thing cost in a month, and turn Stripe's balance transactions and
 * subscriptions into income by month, MRR and the customer list.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const cents = (n) => Math.round(Number(n || 0) * 100) / 100;
const monthKey = (year, i) => `${year}-${String(i + 1).padStart(2, "0")}`;
const keyOfDate = (d) => {
  const x = new Date(d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** "$1,234.50" → 1234.5; empty → null. */
function money(s) {
  const t = String(s ?? "").replace(/[$,\s]/g, "");
  if (!t) return null;
  const n = Number(t.replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : null;
}

/**
 * The expense tracker sheet: a header row with Service, Category and the
 * months, one row per service, until the Total row. Returns
 * [{ name, category, cadence, amount, startMonth, months: { "2026-01": 15 } }].
 * A service paid in only one month is once (or yearly, for developer
 * accounts); everything else is monthly at its latest amount.
 */
function parseExpenseSheet(rows, year) {
  const headerAt = rows.findIndex((r) => r.some((c) => /^service$/i.test(String(c).trim())) && r.some((c) => /^jan/i.test(String(c).trim())));
  if (headerAt < 0) throw new Error("Couldn't find the header row (Service, Category, Jan … Dec).");
  const header = rows[headerAt].map((c) => String(c).trim());
  const col = (re) => header.findIndex((c) => re.test(c));
  const nameCol = col(/^service$/i);
  const catCol = col(/^category$/i);
  const monthCols = MONTHS.map((m) => header.findIndex((c) => new RegExp(`^${m}`, "i").test(c)));
  const out = [];
  for (const r of rows.slice(headerAt + 1)) {
    const name = String(r[nameCol] ?? "").trim();
    if (!name) continue;
    if (/^total/i.test(name)) break;
    const months = {};
    monthCols.forEach((c, i) => {
      if (c < 0) return;
      const v = money(r[c]);
      if (v !== null) months[monthKey(year, i)] = cents(v);
    });
    const paid = Object.entries(months).filter(([, v]) => v > 0);
    const latest = paid.length ? paid[paid.length - 1][1] : 0;
    // Paid in one month and $0 after it = once. Paid and then left blank (Klaviyo) = monthly from then on.
    const once = paid.length === 1 && Object.entries(months).some(([k, v]) => k > paid[0][0] && v === 0);
    const yearly = once && /apple|developer program|domain/i.test(name);
    out.push({
      name,
      category: catCol >= 0 ? String(r[catCol] ?? "").trim() : "",
      cadence: yearly ? "yearly" : once ? "one_time" : "monthly",
      amount: latest,
      startMonth: paid.length ? paid[0][0] : "",
      months,
    });
  }
  return out;
}

/** A Google Sheets link → its CSV download link (keeps the tab). */
function sheetCsvUrl(url) {
  const m = String(url || "").match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) return null;
  const gid = String(url).match(/[#&?]gid=(\d+)/);
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid[1]}` : ""}`;
}

/**
 * What an expense cost in a month ("2026-03"): the month's own number if
 * there is one, otherwise its usual cost when it applies that month.
 */
function costFor(e, month) {
  const own = e.months instanceof Map ? e.months.get(month) : e.months?.[month];
  if (own !== undefined && own !== null) return cents(own);
  if (e.startMonth && month < e.startMonth) return 0;
  if (e.endMonth && month > e.endMonth) return 0;
  if (e.cadence === "monthly") return cents(e.amount);
  if (e.cadence === "yearly") return e.startMonth && month.slice(5) === e.startMonth.slice(5) ? cents(e.amount) : 0;
  return e.startMonth && month === e.startMonth ? cents(e.amount) : 0; // once
}

// Balance transaction types that are money in, money back, or Stripe's own fees.
const IN = new Set(["charge", "payment"]);
const BACK = new Set(["refund", "payment_refund", "payment_failure_refund"]);
const FEES = new Set(["stripe_fee", "tax_fee"]);

const customerId = (c) => (typeof c === "string" ? c : c?.id || null);

/**
 * Which subscriptions and customers are WiserShifts': a subscription made
 * by our checkout or invoices (it carries a tenantId), or one a workspace
 * has saved, and the customers behind them and behind every workspace. The
 * same Stripe account took other payments before, and those stay out.
 */
function wiserShifts({ subs, tenants, hidden = [] }) {
  const tenantSubs = new Set(tenants.map((t) => t.stripeSubscriptionId).filter(Boolean));
  const customers = new Set(tenants.map((t) => t.stripeCustomerId).filter(Boolean));
  const ours = subs.filter((s) => s.metadata?.tenantId || s.customer?.metadata?.tenantId || tenantSubs.has(s.id) || customers.has(customerId(s.customer)));
  for (const s of ours) if (customerId(s.customer)) customers.add(customerId(s.customer));
  // Customers hidden as tests: out of the list, MRR and income.
  const hide = new Set(hidden);
  for (const id of hide) customers.delete(id);
  return { subs: ours.filter((s) => !hide.has(customerId(s.customer))), customers, hiddenSubs: ours.filter((s) => hide.has(customerId(s.customer))) };
}

/**
 * Income by month from Stripe balance transactions (amounts in cents).
 * keep(t) says whether a transaction is WiserShifts'; the rest are counted
 * in left so the page can say what was left out.
 */
function incomeByMonth(txs, year, keep = () => true) {
  const months = Object.fromEntries(MONTHS.map((_, i) => [monthKey(year, i), { gross: 0, refunds: 0, fees: 0, net: 0, payments: 0 }]));
  const left = { count: 0, amount: 0 };
  for (const t of txs) {
    const m = months[keyOfDate(t.created * 1000)];
    if (!m) continue;
    if (!IN.has(t.type) && !BACK.has(t.type) && !FEES.has(t.type)) continue;
    if (!keep(t)) {
      left.count += 1;
      left.amount = cents(left.amount + t.amount / 100);
      continue;
    }
    if (IN.has(t.type)) {
      m.gross += t.amount / 100;
      m.fees += (t.fee || 0) / 100;
      m.payments += 1;
    } else if (BACK.has(t.type)) {
      m.refunds += t.amount / 100; // negative
      m.fees += (t.fee || 0) / 100;
    } else if (FEES.has(t.type)) {
      m.fees += -t.amount / 100;
    } else continue;
  }
  for (const m of Object.values(months)) {
    m.gross = cents(m.gross);
    m.refunds = cents(m.refunds);
    m.fees = cents(m.fees);
    m.net = cents(m.gross + m.refunds - m.fees);
  }
  Object.defineProperty(months, "left", { value: left, enumerable: false });
  return months;
}

/** A subscription's monthly value in dollars (yearly plans count a twelfth). */
function monthlyValue(sub) {
  let total = 0;
  for (const it of sub.items?.data || []) {
    const p = it.price || it.plan || {};
    const unit = (p.unit_amount ?? p.amount ?? 0) / 100;
    const every = p.recurring?.interval_count || p.interval_count || 1;
    const interval = p.recurring?.interval || p.interval || "month";
    const perMonth = interval === "year" ? unit / (12 * every) : interval === "week" ? (unit * 52) / 12 / every : interval === "day" ? (unit * 365) / 12 / every : unit / every;
    total += perMonth * (it.quantity || 1);
  }
  return cents(total);
}

const STATUS = { active: "Paying", trialing: "Trial", past_due: "Payment failed", unpaid: "Unpaid", canceled: "Canceled", incomplete: "Incomplete", incomplete_expired: "Expired", paused: "Paused" };

/** Subscriptions → the customer list, MRR, and new and canceled by month. */
function subscriptionSummary(subs, year) {
  const list = subs.map((s) => {
    const c = typeof s.customer === "object" && s.customer ? s.customer : {};
    const price = s.items?.data?.[0]?.price || {};
    return {
      id: s.id,
      test: monthlyValue(s) > 0 && monthlyValue(s) < 1, // a few cents a month: almost certainly a test checkout
      customerId: customerId(s.customer),
      customer: c.name || c.email || (typeof s.customer === "string" ? s.customer : ""),
      email: c.email || "",
      plan: price.nickname || price.product?.name || (price.recurring?.interval === "year" ? "Yearly" : "Monthly"),
      monthly: monthlyValue(s),
      status: s.status,
      statusLabel: STATUS[s.status] || s.status,
      started: s.start_date ? new Date(s.start_date * 1000) : s.created ? new Date(s.created * 1000) : null,
      trialEnd: s.trial_end ? new Date(s.trial_end * 1000) : null,
      ended: s.ended_at ? new Date(s.ended_at * 1000) : s.canceled_at ? new Date(s.canceled_at * 1000) : null,
      cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
    };
  });
  // Only subscriptions that are paid up count. A failed payment isn't money yet.
  const paying = list.filter((s) => s.status === "active");
  const failing = list.filter((s) => s.status === "past_due" || s.status === "unpaid");
  const mrr = cents(paying.reduce((a, s) => a + s.monthly, 0));
  const byMonth = Object.fromEntries(MONTHS.map((_, i) => [monthKey(year, i), { started: 0, canceled: 0 }]));
  for (const s of list) {
    if (s.started && byMonth[keyOfDate(s.started)]) byMonth[keyOfDate(s.started)].started += 1;
    if (s.ended && s.status === "canceled" && byMonth[keyOfDate(s.ended)]) byMonth[keyOfDate(s.ended)].canceled += 1;
  }
  const order = { active: 0, past_due: 1, trialing: 2 };
  list.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.monthly - a.monthly || String(a.customer).localeCompare(String(b.customer)));
  return {
    list,
    mrr,
    paying: paying.length,
    trialing: list.filter((s) => s.status === "trialing").length,
    failing: failing.length,
    atRisk: cents(failing.reduce((a, s) => a + s.monthly, 0)), // a month, if their payments go through
    byMonth,
  };
}

/**
 * The year's P&L by month: income from Stripe, each expense and category,
 * and profit. Months after this one are projections: expenses from the
 * usual costs, income left out.
 */
function profitAndLoss({ year, income, expenses, now = new Date() }) {
  const thisMonth = keyOfDate(now);
  const months = MONTHS.map((label, i) => {
    const month = monthKey(year, i);
    const inc = income?.[month] || { gross: 0, refunds: 0, fees: 0, net: 0, payments: 0 };
    const byCategory = {};
    const byExpense = {};
    for (const e of expenses) {
      const c = costFor(e, month);
      byExpense[String(e._id)] = c;
      const cat = e.category || "Other";
      byCategory[cat] = cents((byCategory[cat] || 0) + c);
    }
    const spent = cents(Object.values(byExpense).reduce((a, b) => a + b, 0));
    const future = month > thisMonth;
    return { month, label, future, current: month === thisMonth, ...inc, expenses: spent, byCategory, byExpense, profit: future ? null : cents(inc.net - spent) };
  });
  const sofar = months.filter((m) => !m.future);
  const sum = (list, k) => cents(list.reduce((a, m) => a + (m[k] || 0), 0));
  return {
    months,
    totals: { gross: sum(sofar, "gross"), refunds: sum(sofar, "refunds"), fees: sum(sofar, "fees"), net: sum(sofar, "net"), expenses: sum(sofar, "expenses"), profit: cents(sum(sofar, "net") - sum(sofar, "expenses")), yearExpenses: sum(months, "expenses") },
  };
}

module.exports = { MONTHS, wiserShifts, customerId, money, parseExpenseSheet, sheetCsvUrl, costFor, incomeByMonth, monthlyValue, subscriptionSummary, profitAndLoss, keyOfDate };
