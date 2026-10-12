const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getEffectivePlanKey,
  hasFeature,
  requiredPlanFor,
  trialAvailable,
  describePlan,
} = require("../config/plans");

const now = new Date("2026-10-12T12:00:00Z");
const later = new Date("2026-10-20T12:00:00Z");
const earlier = new Date("2026-10-01T12:00:00Z");

test("new workspaces are on Free with a trial available", () => {
  const tenant = { plan: "free", subscriptionStatus: "inactive" };
  assert.equal(getEffectivePlanKey(tenant, now), "free");
  assert.equal(trialAvailable(tenant), true);
});

test("an active trial gives Pro; an expired one falls back to Free", () => {
  const trialing = { plan: "free", trialUsedAt: earlier, trialEndsAt: later };
  assert.equal(getEffectivePlanKey(trialing, now), "pro");
  assert.equal(trialAvailable(trialing), false);

  const expired = { plan: "free", trialUsedAt: earlier, trialEndsAt: earlier };
  assert.equal(getEffectivePlanKey(expired, now), "free");
  assert.equal(trialAvailable(expired), false);
});

test("paid plans win while the subscription is in good standing", () => {
  assert.equal(
    getEffectivePlanKey({ plan: "facility", subscriptionStatus: "active" }, now),
    "facility",
  );
  assert.equal(
    getEffectivePlanKey({ plan: "pro", subscriptionStatus: "past_due" }, now),
    "pro",
  );
  assert.equal(
    getEffectivePlanKey({ plan: "pro", subscriptionStatus: "canceled" }, now),
    "free",
  );
  assert.equal(
    trialAvailable({ plan: "pro", subscriptionStatus: "active" }),
    false,
  );
});

test("features and the cheapest plan that has them", () => {
  assert.equal(hasFeature("free", "sms"), false);
  assert.equal(hasFeature("pro", "sms"), true);
  assert.equal(hasFeature("pro", "timeClock"), false);
  assert.equal(requiredPlanFor("sms"), "pro");
  assert.equal(requiredPlanFor("timeClock"), "facility");
  assert.equal(requiredPlanFor("branding"), "organization");
});

test("unlimited limits serialize as null", () => {
  assert.deepEqual(describePlan("organization").limits, {
    staff: null,
    schedulers: null,
  });
  assert.deepEqual(describePlan("free").limits, { staff: 15, schedulers: 1 });
});
