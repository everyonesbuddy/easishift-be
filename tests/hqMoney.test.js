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
