const test = require("node:test");
const assert = require("node:assert/strict");
const { parse } = require("csv-parse/sync");
const m = require("../utils/hq/money");

const SHEET = `,Wisershifts Expense Tracker

,Total YTD Spend,,Total Projected Annual Burn,,Average Monthly Burn
,$303.00,,$840.00,,$71.67

,Service,Category,Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec,Total Spend
,MongoDB,Database,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00
,Postmark,Email,$15.00,$15.00,$15.00,$15.00,$15.00,$15.00,$15.00,$15.00,$15.00,$15.00,$15.00,$15.00,$180.00
,Heroku,Hosting,$20.00,$25.00,$32.00,$25.67,$25.67,$25.67,$25.67,$25.67,$25.67,$25.67,$25.67,$25.67,$308.00
,Apple App Store,Developer,$99.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$99.00
,Google Play,Developer,$25.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$25.00
,Klaviyo,Marketing,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$0.00,$20.00
,Claude,AI

,Total Monthly Burn,,$178.00,$59.00,$66.00
`;

test("money: expense sheet reads services, cadence and months", () => {
  const out = m.parseExpenseSheet(parse(SHEET, { relax_column_count: true }), 2026);
  const by = Object.fromEntries(out.map((e) => [e.name, e]));
  assert.deepEqual(out.map((e) => e.name), ["MongoDB", "Postmark", "Heroku", "Apple App Store", "Google Play", "Klaviyo", "Claude"]);
  assert.equal(by.Heroku.amount, 25.67);
  assert.equal(by.Heroku.months["2026-03"], 32);
  assert.equal(by["Apple App Store"].cadence, "yearly");
  assert.equal(by["Google Play"].cadence, "one_time");
  assert.equal(by.Klaviyo.cadence, "monthly"); // paid in Aug, blank after = still paying
  assert.equal(by.Klaviyo.startMonth, "2026-08");
  assert.equal(m.costFor(by.Klaviyo, "2026-10"), 20);
  assert.equal(m.costFor(by.Klaviyo, "2026-03"), 0);
  assert.equal(by.Claude.amount, 0);
  assert.throws(() => m.parseExpenseSheet([["a", "b"]], 2026), /header/);
});

test("money: a month's own cost wins; yearly repeats on its month; ranges apply", () => {
  const e = { cadence: "monthly", amount: 10, startMonth: "2026-02", endMonth: "2026-05", months: { "2026-03": 12 } };
  assert.deepEqual(["2026-01", "2026-02", "2026-03", "2026-06"].map((k) => m.costFor(e, k)), [0, 10, 12, 0]);
  const y = { cadence: "yearly", amount: 99, startMonth: "2025-01", months: {} };
  assert.equal(m.costFor(y, "2026-01"), 99);
  assert.equal(m.costFor(y, "2026-02"), 0);
  assert.equal(m.costFor({ cadence: "one_time", amount: 25, startMonth: "2026-01", months: new Map() }, "2027-01"), 0);
});

test("money: Google Sheets link becomes its CSV link", () => {
  assert.equal(m.sheetCsvUrl("https://docs.google.com/spreadsheets/d/abc_12-X/edit?usp=sharing"), "https://docs.google.com/spreadsheets/d/abc_12-X/export?format=csv");
  assert.equal(m.sheetCsvUrl("https://docs.google.com/spreadsheets/d/abc/edit#gid=77"), "https://docs.google.com/spreadsheets/d/abc/export?format=csv&gid=77");
  assert.equal(m.sheetCsvUrl("https://example.com"), null);
  assert.equal(m.money("$1,234.50"), 1234.5);
  assert.equal(m.money(""), null);
});

test("money: Stripe balance transactions → gross, refunds, fees, net by month", () => {
  const t = (d, type, amount, fee = 0) => ({ created: Date.UTC(2026, d, 5) / 1000, type, amount, fee });
  const inc = m.incomeByMonth([t(0, "charge", 4900, 172), t(0, "charge", 4900, 172), t(0, "refund", -4900, 0), t(1, "stripe_fee", -200), t(1, "payout", -9000), t(2, "payment", 9900, 317)], 2026);
  assert.deepEqual(inc["2026-01"], { gross: 98, refunds: -49, fees: 3.44, net: 45.56, payments: 2 });
  assert.equal(inc["2026-02"].fees, 2);
  assert.equal(inc["2026-02"].net, -2);
  assert.equal(inc["2026-03"].net, 95.83);
});

test("money: subscriptions → MRR (yearly / 12), paying, trial, new and canceled", () => {
  const sub = (status, amount, interval, start, extra = {}) => ({ id: status + amount, status, start_date: Date.UTC(2026, start, 3) / 1000, customer: { name: "Elm House", email: "a@b.co" }, items: { data: [{ quantity: 1, price: { unit_amount: amount, recurring: { interval, interval_count: 1 } } }] }, ...extra });
  const s = m.subscriptionSummary([sub("active", 4900, "month", 0), sub("active", 58800, "year", 1), sub("trialing", 4900, "month", 9), sub("canceled", 4900, "month", 2, { ended_at: Date.UTC(2026, 4, 1) / 1000 })], 2026);
  assert.equal(s.mrr, 98);
  assert.equal(s.paying, 2);
  assert.equal(s.failing, 0);
  assert.equal(s.trialing, 1);
  assert.equal(s.byMonth["2026-05"].canceled, 1);
  assert.equal(s.byMonth["2026-01"].started, 1);
  assert.equal(s.list[0].status, "active");
});

test("money: P&L leaves future months unprojected for income, totals only to now", () => {
  const pl = m.profitAndLoss({ year: 2026, income: { "2026-01": { gross: 100, refunds: 0, fees: 3, net: 97, payments: 2 } }, expenses: [{ _id: "x", name: "Heroku", category: "Hosting", cadence: "monthly", amount: 25, months: {} }], now: new Date(Date.UTC(2026, 1, 10)) });
  assert.equal(pl.months[0].profit, 72);
  assert.equal(pl.months[1].current, true);
  assert.equal(pl.months[2].future, true);
  assert.equal(pl.months[2].profit, null);
  assert.equal(pl.totals.expenses, 50);
  assert.equal(pl.totals.profit, 47);
  assert.equal(pl.totals.yearExpenses, 300);
});

test("money: only WiserShifts subscriptions, customers and payments count", () => {
  const subs = [
    { id: "sub_ws", metadata: { tenantId: "t1" }, customer: "cus_a" },
    { id: "sub_saved", metadata: {}, customer: { id: "cus_b" } },
    { id: "sub_old", metadata: {}, customer: "cus_old" },
    { id: "sub_cust", metadata: {}, customer: "cus_c" },
  ];
  const { subs: ours, customers } = m.wiserShifts({ subs, tenants: [{ stripeSubscriptionId: "sub_saved" }, { stripeCustomerId: "cus_c" }] });
  assert.deepEqual(ours.map((s) => s.id), ["sub_ws", "sub_saved", "sub_cust"]);
  assert.deepEqual([...customers].sort(), ["cus_a", "cus_b", "cus_c"]);
  const t = (type, amount, who) => ({ created: Date.UTC(2026, 0, 5) / 1000, type, amount, fee: 0, who });
  const inc = m.incomeByMonth([t("charge", 4900, "cus_a"), t("charge", 25000, "cus_old"), t("charge", 1000, null), t("refund", -4900, "cus_old"), t("stripe_fee", -200, null)], 2026, (x) => customers.has(x.who));
  assert.equal(inc["2026-01"].gross, 49);
  assert.equal(inc["2026-01"].refunds, 0);
  assert.equal(inc["2026-01"].fees, 0);
  assert.deepEqual(inc.left, { count: 4, amount: 209 });
});

test("money: a failed payment isn't MRR; hidden test customers are left out", () => {
  const sub = (id, cus, status, amount, interval = "month") => ({ id, status, metadata: { tenantId: "t" }, customer: cus, start_date: Date.UTC(2026, 0, 2) / 1000, items: { data: [{ quantity: 1, price: { unit_amount: amount, recurring: { interval } } }] } });
  const all = [sub("s1", "cus_me", "active", 200, "year"), sub("s2", "cus_me", "active", 200, "year"), sub("s3", "cus_sc", "past_due", 80000)];
  const s = m.subscriptionSummary(all, 2026);
  assert.equal(s.mrr, 0.34);
  assert.equal(s.paying, 2);
  assert.equal(s.failing, 1);
  assert.equal(s.atRisk, 800);
  assert.equal(s.list.find((x) => x.id === "s1").test, true);
  const w = m.wiserShifts({ subs: all, tenants: [{ stripeCustomerId: "cus_me" }], hidden: ["cus_me"] });
  assert.deepEqual(w.subs.map((x) => x.id), ["s3"]);
  assert.equal(w.hiddenSubs.length, 2);
  assert.equal(w.customers.has("cus_me"), false);
  const after = m.subscriptionSummary(w.subs, 2026);
  assert.equal(after.mrr, 0);
  assert.equal(after.paying, 0);
});

test("money: payment nudge draft and email put the pay button in and escape the message", () => {
  const n = require("../utils/hq/nudge");
  const d = n.draftNudge({ customer: "Silver Comet", plan: "WiserShifts Growth", amountDue: 80000, sender: "Joseph", senderEmail: "me@example.com" });
  assert.match(d.message, /Growth payment of \$800 for Silver Comet/);
  assert.match(d.message, /me@example.com/);
  const html = n.nudgeHtml({ message: "Hi <b>Melanie</b>,\n\nIt failed.\n\nUse the button.\n\nThanks", payUrl: "https://invoice.stripe.com/i/x", amountDue: 80000 });
  assert.match(html, /Hi &lt;b&gt;Melanie/);
  assert.match(html, /href="https:\/\/invoice.stripe.com\/i\/x"/);
  assert.match(html, /Pay \$800 or update card/);
  assert.ok(html.indexOf("Use the button") < html.indexOf("Pay $800") && html.indexOf("Pay $800") < html.indexOf("Thanks"));
  assert.match(n.nudgeText({ message: "Hi", payUrl: "u" }), /Pay or update your card: u/);
});

test("money: billing dates, from the subscription or (newer Stripe) its items", () => {
  const money = require("../utils/hq/money");
  const oct15 = Date.UTC(2026, 9, 15) / 1000;
  const nov15 = Date.UTC(2026, 10, 15) / 1000;
  const price = { unit_amount: 80000, recurring: { interval: "month", interval_count: 1 } };
  const old = money.billing({ status: "active", current_period_start: oct15, current_period_end: nov15, items: { data: [{ price, quantity: 1 }] }, collection_method: "send_invoice" });
  assert.equal(old.periodStart.toISOString().slice(0, 10), "2026-10-15");
  assert.equal(old.nextCharge.toISOString().slice(0, 10), "2026-11-15");
  assert.equal(old.amount, 800);
  assert.equal(old.every, "month");
  assert.equal(old.collection, "invoice");
  const fresh = money.billing({ status: "active", items: { data: [{ price, quantity: 1, current_period_start: oct15, current_period_end: nov15 }] } });
  assert.equal(fresh.periodEnd.toISOString().slice(0, 10), "2026-11-15", "newer API: period on the item");
  assert.equal(money.billing({ status: "active", cancel_at_period_end: true, current_period_end: nov15, items: { data: [{ price }] } }).nextCharge, null, "canceling: no next charge");
});

test("money: when each subscription paid, and what's still open", () => {
  const money = require("../utils/hq/money");
  const t = (s) => Date.parse(s) / 1000;
  const now = new Date("2026-11-10T12:00:00Z");
  const timing = money.paymentTiming(
    [
      // Silver Comet: invoiced Oct 15, due Oct 15, paid Nov 7 (newer API shape for the subscription).
      { parent: { subscription_details: { subscription: "sub_sc" } }, status: "paid", amount_paid: 80000, created: t("2026-10-15"), due_date: t("2026-10-15"), status_transitions: { finalized_at: t("2026-10-15T19:19:00Z"), paid_at: t("2026-11-07T18:43:00Z") } },
      // On time, by card.
      { subscription: "sub_ok", status: "paid", amount_paid: 50000, created: t("2026-11-01"), status_transitions: { finalized_at: t("2026-11-01"), paid_at: t("2026-11-01T00:05:00Z") } },
      // Open and overdue.
      { subscription: "sub_late", status: "open", amount_due: 40000, amount_remaining: 40000, created: t("2026-10-20"), due_date: t("2026-10-30"), hosted_invoice_url: "https://invoice", status_transitions: { finalized_at: t("2026-10-20") } },
      { subscription: "sub_late", status: "draft", amount_due: 1, created: t("2026-11-09") },
    ],
    now,
  );
  assert.equal(timing.sub_sc.lastPaid.daysAfter, 23);
  assert.equal(timing.sub_sc.latePaid, 1, "more than a week after it was due");
  assert.equal(timing.sub_ok.lastPaid.daysAfter, 0);
  assert.equal(timing.sub_ok.latePaid, 0);
  assert.equal(timing.sub_late.open.daysOverdue, 11);
  assert.equal(timing.sub_late.open.amount, 400);
  assert.equal(timing.sub_late.lastPaid, null, "drafts don't count");
});

test("money: earned, settling (with when it lands), and the account's balance and payouts", () => {
  const money = require("../utils/hq/money");
  const now = new Date("2026-11-10T12:00:00Z");
  const t = (s) => Date.parse(s) / 1000;
  const txs = [
    { type: "payment", amount: 80000, fee: 2350, net: 77650, status: "pending", available_on: t("2026-11-12"), mine: true },
    { type: "charge", amount: 10000, fee: 320, net: 9680, status: "available", available_on: t("2026-10-01"), mine: true },
    { type: "charge", amount: 242720, fee: 0, net: 242720, status: "available", mine: false },
  ];
  const c = money.cashSummary({
    txs,
    keep: (x) => x.mine,
    balance: { available: [{ amount: -9527, currency: "usd" }], pending: [{ amount: 77650, currency: "usd" }] },
    payouts: [{ amount: 200000, status: "paid", arrival_date: t("2026-02-01") }, { amount: 5000, status: "failed", arrival_date: t("2026-03-01") }],
    now,
  });
  assert.equal(c.earned, 873.3);
  assert.equal(c.settling, 776.5);
  assert.equal(c.landsOn.toISOString().slice(0, 10), "2026-11-12");
  assert.deepEqual(c.account, { available: -95.27, pending: 776.5 });
  assert.equal(c.payouts.total, 2000, "failed payouts don't count");
  assert.equal(c.payouts.last.status, "failed");
});
