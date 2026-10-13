const test = require("node:test");
const assert = require("node:assert/strict");

const controller = require("../controllers/stripeController");

const withEnv = (vars, fn) => {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const PRICE_ENV = {
  STRIPE_PRICE_STARTER_MONTHLY: "price_st_m",
  STRIPE_PRICE_STARTER_YEARLY: "price_st_y",
  STRIPE_PRICE_GROWTH_MONTHLY: "price_gr_m",
  STRIPE_PRICE_GROWTH_YEARLY: "price_gr_y",
  STRIPE_PRICE_PREMIUM_MONTHLY: "price_pr_m",
  STRIPE_PRICE_PREMIUM_YEARLY: "price_pr_y",
};

test("maps Stripe price ids back to plan + interval", () => {
  withEnv(PRICE_ENV, () => {
    assert.deepEqual(controller._planFromPriceId("price_st_m"), {
      plan: "starter",
      interval: "month",
    });
    assert.deepEqual(controller._planFromPriceId("price_gr_y"), {
      plan: "growth",
      interval: "year",
    });
    assert.deepEqual(controller._planFromPriceId("price_pr_m"), {
      plan: "premium",
      interval: "month",
    });
    assert.equal(controller._planFromPriceId("price_unknown"), null);
    assert.equal(controller._planFromPriceId(null), null);
  });
});

test("builds tenant updates from subscription webhooks", () => {
  withEnv(PRICE_ENV, () => {
    const active = controller._buildSubscriptionUpdate({
      status: "active",
      items: { data: [{ price: { id: "price_gr_m" } }] },
    });
    assert.equal(active.plan, "growth");
    assert.equal(active.billingInterval, "month");
    assert.equal(active.subscriptionStatus, "active");

    const canceled = controller._buildSubscriptionUpdate({
      status: "canceled",
      items: { data: [{ price: { id: "price_st_m" } }] },
    });
    assert.equal(canceled.plan, "free");
    assert.equal(canceled.stripeSubscriptionId, null);
  });
});

test("card trial at checkout: 7 days monthly, 30 yearly, only for first-timers", () => {
  const fresh = {};
  assert.equal(controller._checkoutTrialDays(fresh, "month"), 7);
  assert.equal(controller._checkoutTrialDays(fresh, "year"), 30);
  assert.equal(controller._checkoutTrialDays({ trialUsedAt: new Date() }, "month"), 0);
  assert.equal(controller._checkoutTrialDays({ cardTrialUsedAt: new Date() }, "year"), 0);
  assert.equal(controller._checkoutTrialDays({ stripeSubscriptionId: "sub_1" }, "month"), 0);
});
