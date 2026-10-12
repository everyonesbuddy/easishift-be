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
  STRIPE_PRICE_PRO_MONTHLY: "price_pro_m",
  STRIPE_PRICE_PRO_YEARLY: "price_pro_y",
  STRIPE_PRICE_FACILITY_MONTHLY: "price_fac_m",
  STRIPE_PRICE_FACILITY_YEARLY: "price_fac_y",
};

test("maps Stripe price ids back to plan + interval", () => {
  withEnv(PRICE_ENV, () => {
    assert.deepEqual(controller._planFromPriceId("price_pro_m"), {
      plan: "pro",
      interval: "month",
    });
    assert.deepEqual(controller._planFromPriceId("price_fac_y"), {
      plan: "facility",
      interval: "year",
    });
    assert.equal(controller._planFromPriceId("price_unknown"), null);
    assert.equal(controller._planFromPriceId(null), null);
  });
});

test("builds tenant updates from subscription webhooks", () => {
  withEnv(PRICE_ENV, () => {
    const active = controller._buildSubscriptionUpdate({
      status: "active",
      items: { data: [{ price: { id: "price_fac_m" } }] },
    });
    assert.equal(active.plan, "facility");
    assert.equal(active.billingInterval, "month");
    assert.equal(active.subscriptionStatus, "active");

    const canceled = controller._buildSubscriptionUpdate({
      status: "canceled",
      items: { data: [{ price: { id: "price_pro_m" } }] },
    });
    assert.equal(canceled.plan, "free");
    assert.equal(canceled.stripeSubscriptionId, null);
  });
});

test("founding price only for Pro monthly while spots and coupon exist", () => {
  withEnv({ STRIPE_FOUNDING_COUPON_ID: "coupon_founding" }, () => {
    assert.equal(controller._qualifiesForFounding("pro", "month", 5), true);
    assert.equal(controller._qualifiesForFounding("pro", "year", 5), false);
    assert.equal(controller._qualifiesForFounding("facility", "month", 5), false);
    assert.equal(controller._qualifiesForFounding("pro", "month", 0), false);
  });
  withEnv({ STRIPE_FOUNDING_COUPON_ID: undefined }, () => {
    assert.equal(controller._qualifiesForFounding("pro", "month", 5), false);
  });
});
