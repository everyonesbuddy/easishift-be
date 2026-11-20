const test = require("node:test");
const assert = require("node:assert/strict");
const { cleanCode, couponWords, findPromotionCode, codeOnSubscription } = require("../utils/referrals");
const P = require("../utils/hq/partners");

test("referral codes: cleaned to capitals, letters and digits", () => {
  assert.equal(cleanCode(" safe hands! "), "SAFEHANDS");
  assert.equal(cleanCode("md-nurse_2"), "MD-NURSE_2");
  assert.equal(cleanCode(""), null);
  assert.equal(cleanCode(null), null);
  assert.equal(couponWords({ percent_off: 100, duration: "repeating", duration_in_months: 1 }), "100% off for 1 month");
  assert.equal(couponWords({ amount_off: 5000, duration: "once" }), "$50 off once");
});

test("referral codes: Stripe lookups never throw", async () => {
  const broken = { promotionCodes: { list: async () => { throw new Error("down"); } }, subscriptions: { retrieve: async () => { throw new Error("down"); } } };
  assert.equal(await findPromotionCode(broken, "SAFEHANDS"), null);
  assert.equal(await codeOnSubscription(broken, "sub_1"), null);
  const ok = {
    subscriptions: { retrieve: async () => ({ id: "sub_1", discounts: [{ promotion_code: "promo_1" }] }) },
    promotionCodes: { retrieve: async () => ({ code: "safehands" }) },
  };
  assert.equal(await codeOnSubscription(ok, "sub_1"), "SAFEHANDS");
  const legacy = { subscriptions: { retrieve: async () => ({ id: "sub_1", discount: { promotion_code: { code: "OLD1" } } }) } };
  assert.equal(await codeOnSubscription(legacy, "sub_1"), "OLD1");
});

test("partners: a flat fee is due after 2 paid months; the free month doesn't count", () => {
  const months = P.paidMonths([
    { status: "paid", amount_paid: 0, created: 100 }, // the free month
    { status: "paid", amount_paid: 19900, created: 200 },
    { status: "open", amount_paid: 0, created: 300 },
  ]);
  assert.equal(months.months, 1);
  const partner = { dealType: "flat", fee: 250, feesPaid: [{ tenantId: "t3", paidAt: new Date("2026-11-01"), amount: 250 }] };
  const tenants = [
    { _id: "t1", name: "One month in", createdAt: new Date("2026-09-01") },
    { _id: "t2", name: "Two months paid", createdAt: new Date("2026-08-01") },
    { _id: "t3", name: "Already paid out", createdAt: new Date("2026-07-01") },
  ];
  const two = { months: 2, firstPaidAt: new Date(), total: 398, payments: [] };
  const paid = new Map([["t1", months], ["t2", two], ["t3", { ...two, months: 4 }]]);
  const rows = P.referralRows(partner, tenants, paid);
  const by = Object.fromEntries(rows.map((r) => [r.tenantId, [r.feeStatus, r.owed]]));
  assert.deepEqual(by, { t1: ["not_yet", 0], t2: ["due", 250], t3: ["paid", 0] });
  assert.deepEqual(P.totals(rows), { introduced: 3, paying: 3, feesDue: 1, feesDueAmount: 250, feesPaidAmount: 250 });
});

test("partners: a percentage deal earns on each payment in the window, minus what we've paid out", () => {
  const start = new Date();
  start.setMonth(start.getMonth() - 13); // first payment 13 months ago: a 12-month window is over
  const inv = (monthsAfter, dollars) => {
    const d = new Date(start);
    d.setMonth(d.getMonth() + monthsAfter);
    return { status: "paid", amount_paid: dollars * 100, created: Math.floor(d.getTime() / 1000) };
  };
  const paid = P.paidMonths([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => inv(m, 200))); // 13 payments of $200
  const partner = { dealType: "percent", percent: 15, percentMonths: 12, feesPaid: [{ tenantId: "t1", paidAt: new Date(), amount: 100 }] };
  const [row] = P.referralRows(partner, [{ _id: "t1", name: "Big DDA agency", createdAt: start }], new Map([["t1", paid]]));
  assert.equal(row.earned, 360, "15% of 12 payments of $200; the 13th is after the window");
  assert.equal(row.paidOut, 100);
  assert.equal(row.owed, 260);
  assert.equal(row.feeStatus, "due");
  assert.equal(P.dealWords(partner), "15% of what each client pays, for 12 months");
  assert.equal(P.dealWords({ fee: 250 }), "$250 flat per client, after 2 paid months");
});

test("partners: changing the deal is recorded, with who and when", async () => {
  const HqPartner = require("../models/hqPartnerModel");
  const { apply } = require("../controllers/hqPartnersController")._test;
  const p = new HqPartner({ name: "Safe Hands" });
  assert.equal(await apply(p, { dealType: "percent", percent: 15, percentMonths: 12, dealNote: "renegotiated on call" }, "J"), null);
  assert.equal(p.dealHistory.length, 1);
  assert.equal(p.dealHistory[0].from, "$250 flat per client, after 2 paid months");
  assert.equal(p.dealHistory[0].to, "15% of what each client pays, for 12 months (renegotiated on call)");
  assert.equal(p.dealHistory[0].by, "J");
  assert.equal(await apply(p, { percent: 15 }, "J"), null);
  assert.equal(p.dealHistory.length, 1, "no change, no entry");
  assert.match(await apply(p, { percent: 80 }, "J"), /between 1 and 50/);
});

test("partners: two partners can't share a code", async () => {
  const HqPartner = require("../models/hqPartnerModel");
  const { apply } = require("../controllers/hqPartnersController")._test;
  const orig = HqPartner.findOne;
  HqPartner.findOne = () => ({ select: () => ({ lean: async () => ({ name: "Safe Hands" }) }) });
  try {
    const p = new HqPartner({ name: "Other Nurse" });
    assert.match(await apply(p, { code: "safehands" }), /Safe Hands already has the code SAFEHANDS/);
    assert.match(await apply(new HqPartner({}), { name: " " }), /name/);
  } finally {
    HqPartner.findOne = orig;
  }
});

test("signup: a partner's code is saved on the workspace, cleaned", () => {
  const src = require("fs").readFileSync(require.resolve("../controllers/authController"), "utf8");
  assert.match(src, /referralCode: cleanCode\(body\.referralCode\)/);
});

test("checkout: a partner code is a free month on monthly plans, 30 extra trial days on yearly (never a free year)", () => {
  const { checkoutCodeOptions } = require("../utils/referrals");
  const promo = { id: "promo_1" };
  assert.deepEqual(checkoutCodeOptions({ interval: "month", promo, code: "SAFEHANDS", trialDays: 7 }), { params: { discounts: [{ promotion_code: "promo_1" }] }, trialDays: 7, metadata: {} });
  assert.deepEqual(checkoutCodeOptions({ interval: "month", promo: null, code: null, trialDays: 7 }), { params: { allow_promotion_codes: true }, trialDays: 7, metadata: {} });
  const year = checkoutCodeOptions({ interval: "year", promo, code: "SAFEHANDS", trialDays: 30 });
  assert.deepEqual(year, { params: {}, trialDays: 60, metadata: { referral: "SAFEHANDS" } });
  assert.ok(!("discounts" in year.params) && !("allow_promotion_codes" in year.params), "no coupon and no code box on a yearly plan");
  assert.deepEqual(checkoutCodeOptions({ interval: "year", promo: null, code: null, trialDays: 0 }), { params: {}, trialDays: 0, metadata: {} });
});

test("partners: a yearly payment counts as 12 paid months, so a flat fee is due right away", () => {
  const P = require("../utils/hq/partners");
  const start = 1767225600; // Jan 1 2026
  const yearly = { status: "paid", amount_paid: 199000, created: start, lines: { data: [{ period: { start, end: start + 365 * 86400 } }] } };
  const monthly = { status: "paid", amount_paid: 19900, created: start, lines: { data: [{ period: { start, end: start + 31 * 86400 } }] } };
  assert.equal(P.paidMonths([yearly]).months, 12);
  assert.equal(P.paidMonths([monthly]).months, 1);
  assert.equal(P.paidMonths([{ status: "paid", amount_paid: 100, created: start }]).months, 1, "no billing period: counts as one month");
  const [row] = P.referralRows({ dealType: "flat", fee: 250 }, [{ _id: "t", name: "Yearly", createdAt: new Date() }], new Map([["t", P.paidMonths([yearly])]]));
  assert.equal(row.feeStatus, "due");
  assert.equal(row.owed, 250);
});
