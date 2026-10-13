const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getEffectivePlanKey,
  hasFeature,
  requiredPlanFor,
  trialAvailable,
  describePlan,
  getPlan,
  inPostTrialGrace,
  PLAN_PRICES,
} = require("../config/plans");

const now = new Date("2026-10-12T12:00:00Z");
const later = new Date("2026-10-20T12:00:00Z");
const earlier = new Date("2026-10-01T12:00:00Z");
const longAgo = new Date("2026-08-01T12:00:00Z");

test("new workspaces are on Free with a trial available", () => {
  const tenant = { plan: "free", subscriptionStatus: "inactive" };
  assert.equal(getEffectivePlanKey(tenant, now), "free");
  assert.equal(trialAvailable(tenant), true);
});

test("an active trial gives Starter; an expired one falls back to Free", () => {
  const trialing = { plan: "free", trialUsedAt: earlier, trialEndsAt: later };
  assert.equal(getEffectivePlanKey(trialing, now), "starter");
  assert.equal(trialAvailable(trialing), false);

  const expired = { plan: "free", trialUsedAt: earlier, trialEndsAt: earlier };
  assert.equal(getEffectivePlanKey(expired, now), "free");
  assert.equal(trialAvailable(expired), false);
});

test("paid plans win while the subscription is in good standing", () => {
  assert.equal(getEffectivePlanKey({ plan: "growth", subscriptionStatus: "active" }, now), "growth");
  assert.equal(getEffectivePlanKey({ plan: "premium", subscriptionStatus: "trialing" }, now), "premium");
  assert.equal(getEffectivePlanKey({ plan: "starter", subscriptionStatus: "past_due" }, now), "starter");
  assert.equal(getEffectivePlanKey({ plan: "starter", subscriptionStatus: "canceled" }, now), "free");
  assert.equal(trialAvailable({ plan: "starter", subscriptionStatus: "active" }), false);
});

test("older plan keys read as the closest new plan", () => {
  assert.equal(getEffectivePlanKey({ plan: "pro", subscriptionStatus: "active" }, now), "starter");
  assert.equal(getEffectivePlanKey({ plan: "facility", subscriptionStatus: "active" }, now), "growth");
  assert.equal(getPlan("organization").key, "enterprise");
  assert.equal(getPlan("nonsense").key, "free");
});

test("Free has the core only; paid plans share features and differ by size", () => {
  assert.equal(hasFeature("free", "sms"), false);
  for (const key of ["starter", "growth", "premium", "enterprise"]) {
    assert.equal(hasFeature(key, "autoFill"), true, key);
    assert.equal(hasFeature(key, "messaging"), true, key);
  }
  assert.equal(requiredPlanFor("sms"), "starter");
  assert.equal(requiredPlanFor("prioritySupport"), "premium");
  assert.equal(requiredPlanFor("branding"), "enterprise");
  assert.deepEqual(
    ["free", "starter", "growth", "premium"].map((k) => describePlan(k).limits),
    [
      { staff: 15, schedulers: 1 },
      { staff: 50, schedulers: 3 },
      { staff: 100, schedulers: 5 },
      { staff: 150, schedulers: 10 },
    ],
  );
});

test("prices match the published pricing", () => {
  assert.deepEqual(PLAN_PRICES.starter, { month: 50000, year: 480000 });
  assert.deepEqual(PLAN_PRICES.growth, { month: 80000, year: 770000 });
  assert.deepEqual(PLAN_PRICES.premium, { month: 100000, year: 960000 });
});

test("unlimited limits serialize as null", () => {
  assert.deepEqual(describePlan("enterprise").limits, { staff: null, schedulers: null });
});

test("grace window is the 14 days after an unpaid trial ends", () => {
  assert.equal(inPostTrialGrace({ trialEndsAt: earlier }, now), true);
  assert.equal(inPostTrialGrace({ trialEndsAt: later }, now), false);
  assert.equal(inPostTrialGrace({ trialEndsAt: longAgo }, now), false);
  assert.equal(inPostTrialGrace({ plan: "starter", subscriptionStatus: "active", trialEndsAt: earlier }, now), false);
  assert.equal(inPostTrialGrace({}, now), false);
});
