const test = require("node:test");
const assert = require("node:assert/strict");
const pay = require("../utils/paymentLinks");

const TENANT = { _id: "6a04bfda5193b12fac01131b", name: "Palm Grove", email: "owner@palmgrove.test" };

function fakeStripe() {
  const calls = [];
  const rec = (name, result) => async (params, options) => {
    calls.push({ name, params, options });
    return typeof result === "function" ? result(params) : result;
  };
  return {
    calls,
    prices: { create: rec("prices.create", (p) => ({ id: p.recurring ? "price_recurring" : "price_backpay" })) },
    paymentLinks: { create: rec("paymentLinks.create", { id: "plink_1", url: "https://buy.stripe.com/test_abc" }) },
    customers: { create: rec("customers.create", { id: "cus_1" }) },
    subscriptions: { create: rec("subscriptions.create", { id: "sub_1", status: "active", latest_invoice: "in_1" }) },
    invoices: {
      finalizeInvoice: rec("invoices.finalize", { id: "in_1", hosted_invoice_url: "https://invoice.stripe.com/i/x", invoice_pdf: "https://pay.stripe.com/pdf" }),
      sendInvoice: rec("invoices.send", { id: "in_1", hosted_invoice_url: "https://invoice.stripe.com/i/x" }),
    },
  };
}

test("parses arguments and fills defaults", () => {
  const o = pay.validate(pay.parseArgs([TENANT._id, "starter", "--email=ap@palmgrove.test", "--create"]));
  assert.equal(o.plan, "starter");
  assert.equal(o.interval, "month");
  assert.equal(o.payBy, "link");
  assert.equal(o.amountCents, 50000);
  assert.equal(o.create, true);
  const custom = pay.validate(pay.parseArgs([TENANT._id, "growth", "--interval=year", "--amount=$7,000"]));
  assert.equal(custom.amountCents, 700000);
  assert.equal(custom.customAmount, true);
});

test("rejects bad input", () => {
  assert.throws(() => pay.validate(pay.parseArgs([TENANT._id, "enterprise"])), /Plan must be/);
  assert.throws(() => pay.validate(pay.parseArgs(["abc", "starter"])), /Tenant ID/);
  assert.throws(() => pay.validate(pay.parseArgs([TENANT._id, "starter", "--interval=week"])), /interval/);
  assert.throws(() => pay.validate(pay.parseArgs([TENANT._id, "starter", "--amount=0"])), /amount/);
  assert.throws(() => pay.parseArgs([TENANT._id, "starter", "--nope"]), /Unknown option/);
});

test("won't make a second subscription for a paying tenant", () => {
  assert.match(pay.existingSubscriptionError({ ...TENANT, stripeSubscriptionId: "sub_9", subscriptionStatus: "active" }), /already has/);
  assert.equal(pay.existingSubscriptionError({ ...TENANT, stripeSubscriptionId: "sub_9", subscriptionStatus: "canceled" }), null);
});

test("payment link: card + ACH, one payment, tenant on the subscription", async () => {
  const stripe = fakeStripe();
  const o = pay.validate(pay.parseArgs([TENANT._id, "starter", "--back-pay=September 2026"]));
  const result = await pay.createPayment({ stripe, saveTenant: async () => assert.fail("link mode saves nothing") }, TENANT, o, "ap@palmgrove.test");
  assert.equal(result.url, "https://buy.stripe.com/test_abc?prefilled_email=ap%40palmgrove.test");
  const link = stripe.calls.find((c) => c.name === "paymentLinks.create").params;
  assert.deepEqual(link.payment_method_types, ["card", "us_bank_account"]);
  assert.equal(link.subscription_data.metadata.tenantId, TENANT._id);
  assert.equal(link.subscription_data.metadata.plan, "starter");
  assert.deepEqual(link.restrictions, { completed_sessions: { limit: 1 } });
  assert.deepEqual(link.line_items.map((l) => l.price), ["price_recurring", "price_backpay"]);
  const [recurring, backpay] = stripe.calls.filter((c) => c.name === "prices.create").map((c) => c.params);
  assert.equal(recurring.unit_amount, 50000);
  assert.equal(recurring.recurring.interval, "month");
  assert.equal(backpay.recurring, undefined);
  assert.ok(stripe.calls.every((c) => c.options?.idempotencyKey));
});

test("invoice: net-30 with card, ACH debit and bank transfer; tenant saved", async () => {
  const stripe = fakeStripe();
  let saved = null;
  const o = pay.validate(pay.parseArgs([TENANT._id, "growth", "--pay-by=invoice", "--send-invoice"]));
  const result = await pay.createPayment({ stripe, saveTenant: async (u) => { saved = u; } }, TENANT, o, "ap@palmgrove.test");
  const sub = stripe.calls.find((c) => c.name === "subscriptions.create").params;
  assert.equal(sub.collection_method, "send_invoice");
  assert.equal(sub.days_until_due, 30);
  assert.deepEqual(sub.payment_settings.payment_method_types, ["card", "us_bank_account", "customer_balance"]);
  assert.equal(sub.payment_settings.payment_method_options.customer_balance.bank_transfer.type, "us_bank_transfer");
  assert.equal(sub.metadata.tenantId, TENANT._id);
  assert.ok(stripe.calls.some((c) => c.name === "invoices.send"));
  assert.equal(result.url, "https://invoice.stripe.com/i/x");
  assert.deepEqual(saved, {
    stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", billingEmail: "ap@palmgrove.test",
    subscriptionStatus: "active", plan: "growth", billingInterval: "month",
  });
});

test("invoice needs an email", async () => {
  const o = pay.validate(pay.parseArgs([TENANT._id, "starter", "--pay-by=invoice"]));
  await assert.rejects(() => pay.createPayment({ stripe: fakeStripe(), saveTenant: async () => {} }, TENANT, o, null), /need an email/);
});

test("webhook finds the tenant on the subscription for payment-link checkouts", async () => {
  const subscription = {
    id: "sub_1", status: "active",
    metadata: { tenantId: TENANT._id, plan: "starter", interval: "month" },
    items: { data: [{ price: { id: "price_x", unit_amount: 50000, recurring: { interval: "month" } } }] },
  };
  const stripePath = require.resolve("stripe");
  const saved = require.cache[stripePath];
  require.cache[stripePath] = {
    id: stripePath, filename: stripePath, loaded: true,
    exports: () => ({
      webhooks: { constructEvent: (payload) => JSON.parse(payload) },
      subscriptions: { retrieve: async () => subscription },
    }),
  };
  const ctrlPath = require.resolve("../controllers/stripeController");
  delete require.cache[ctrlPath];
  const Tenant = require("../models/tenantModel");
  const original = Tenant.findByIdAndUpdate;
  let call = null;
  Tenant.findByIdAndUpdate = async (id, update) => { call = { id, update }; };
  try {
    const ctrl = require("../controllers/stripeController");
    const event = { type: "checkout.session.completed", data: { object: { subscription: "sub_1", customer: "cus_1", customer_details: { email: "ap@palmgrove.test" }, metadata: {} } } };
    let body = null;
    const res = { json: (b) => { body = b; }, status: () => res, send: () => {} };
    await ctrl.handleWebhook({ headers: {}, rawBody: JSON.stringify(event) }, res);
    assert.deepEqual(body, { received: true });
    assert.equal(call.id, TENANT._id);
    assert.equal(call.update.plan, "starter");
    assert.equal(call.update.stripeSubscriptionId, "sub_1");
    assert.equal(call.update.billingEmail, "ap@palmgrove.test");
  } finally {
    Tenant.findByIdAndUpdate = original;
    if (saved) require.cache[stripePath] = saved; else delete require.cache[stripePath];
    delete require.cache[ctrlPath];
  }
});
