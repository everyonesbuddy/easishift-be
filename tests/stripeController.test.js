const test = require("node:test");
const assert = require("node:assert/strict");

const controller = require("../controllers/stripeController");

test("builds a recurring monthly item plus a one-time prior-period item", () => {
  const items = controller.buildCheckoutLineItems(
    "growthMonthly",
    true,
    "August 2026",
  );

  assert.equal(items.length, 2);
  assert.deepEqual(items[0].price_data.recurring, { interval: "month" });
  assert.equal(items[0].price_data.unit_amount, 80000);
  assert.equal(items[1].price_data.recurring, undefined);
  assert.equal(items[1].price_data.unit_amount, 80000);
  assert.equal(
    items[1].price_data.product_data.name,
    "Growth Monthly service - August 2026",
  );
});

test("rejects checkout for a tenant outside the authenticated context", async () => {
  const req = {
    tenantId: "authenticated-tenant",
    body: {
      tenantId: "different-tenant",
      planKey: "growthMonthly",
    },
  };
  const response = {};
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };

  await controller.createCheckoutSession(req, response, assert.fail);

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, {
    message: "Cannot create a checkout session for another tenant",
  });
});
