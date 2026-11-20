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

test("partners: the fee is due after 2 paid months; the free month doesn't count", () => {
  const months = P.paidMonths([
    { status: "paid", amount_paid: 0, created: 100 }, // the free month
    { status: "paid", amount_paid: 19900, created: 200 },
    { status: "open", amount_paid: 0, created: 300 },
  ]);
  assert.equal(months.months, 1);
  const partner = { fee: 250, feesPaid: [{ tenantId: "t3", paidAt: new Date("2026-11-01"), amount: 250 }] };
  const tenants = [
    { _id: "t1", name: "One month in", createdAt: new Date("2026-09-01") },
    { _id: "t2", name: "Two months paid", createdAt: new Date("2026-08-01") },
    { _id: "t3", name: "Already paid out", createdAt: new Date("2026-07-01") },
  ];
  const paid = new Map([
    ["t1", months],
    ["t2", { months: 2, firstPaidAt: new Date(), total: 398 }],
    ["t3", { months: 4, firstPaidAt: new Date(), total: 796 }],
  ]);
  const rows = P.referralRows(partner, tenants, paid);
  const by = Object.fromEntries(rows.map((r) => [r.tenantId, r.feeStatus]));
  assert.deepEqual(by, { t1: "not_yet", t2: "due", t3: "paid" });
  assert.deepEqual(P.totals(rows, 250), { introduced: 3, paying: 3, feesDue: 1, feesDueAmount: 250, feesPaidAmount: 250 });
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
