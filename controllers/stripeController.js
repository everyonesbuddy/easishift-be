const Stripe = require("stripe");
const Tenant = require("../models/tenantModel");

// Use env key but allow a fallback dummy to avoid crashes in dev without env set
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key");

// Plan mapping: planKey -> price (cents) and seats (yearly plans)
// Prices are in cents: $3000 -> 300000 cents
const PLANS = {
  starter: { priceCents: 300000, seats: 10, name: "Starter" },
  growth: { priceCents: 500000, seats: 20, name: "Growth" },
  premium: { priceCents: 700000, seats: 30, name: "Premium" },
  test: { priceCents: 200, seats: 12, name: "Test" },
};

/**
 * Create a Checkout Session for a tenant to purchase a subscription.
 * Expects { tenantId, planKey } in body.
 */
exports.createCheckoutSession = async (req, res, next) => {
  try {
    const { tenantId, planKey } = req.body;

    if (!tenantId || !planKey) {
      return res
        .status(400)
        .json({ message: "tenantId and planKey are required" });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const plan = PLANS[planKey];
    if (!plan) return res.status(400).json({ message: "Invalid planKey" });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `${plan.name} plan (Patient Communication)` },
            recurring: { interval: "year" },
            unit_amount: plan.priceCents,
          },
          quantity: 1,
        },
      ],
      client_reference_id: tenantId,
      metadata: { tenantId, planKey },
      // Ensure the subscription object itself carries tenant metadata so future
      // subscription/invoice webhooks can directly reference tenantId.
      subscription_data: {
        metadata: { tenantId, planKey },
      },
      success_url: `${
        process.env.FRONTEND_URL || "http://localhost:3000"
      }/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${
        process.env.FRONTEND_URL || "http://localhost:3000"
      }/billing/cancel`,
    });

    res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    next(err);
  }
};

/**
 * Stripe Webhook handler.
 * Verifies signature and updates Tenant billing info and seatLimit.
 */
exports.handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_dummy";

  let event;
  try {
    // Prefer rawBody captured by the express.json verify hook or route-level raw
    // body parser. If not available, stringify the parsed body as a fallback
    // (useful for local dev where signature verification may not be strict).
    let payload = req.rawBody || req.body;
    if (payload && typeof payload !== "string" && !Buffer.isBuffer(payload)) {
      payload = JSON.stringify(payload);
    }

    event = stripe.webhooks.constructEvent(payload, sig, webhookSecret);
  } catch (err) {
    console.error("⚠️  Webhook signature verification failed.", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const type = event.type;

    // Handle checkout.session.completed to capture initial subscription
    if (type === "checkout.session.completed") {
      const session = event.data.object;
      const tenantId = session.metadata && session.metadata.tenantId;
      const planKey = session.metadata && session.metadata.planKey;

      // Retrieve subscription to get price id
      const subscription = session.subscription
        ? await stripe.subscriptions.retrieve(session.subscription)
        : null;

      const priceId =
        subscription && subscription.items && subscription.items.data[0]
          ? subscription.items.data[0].price.id
          : null;

      if (tenantId && planKey) {
        const plan = PLANS[planKey];
        const update = {
          billingEmail: session.customer_details
            ? session.customer_details.email
            : session.customer_email || null,
          stripeCustomerId: session.customer || null,
          stripeSubscriptionId: session.subscription || null,
          stripePriceId: priceId,
          planKey,
          subscriptionStatus: "active",
          seatLimit: plan ? plan.seats : undefined,
        };

        // Remove undefined fields
        Object.keys(update).forEach(
          (k) => update[k] === undefined && delete update[k]
        );

        await Tenant.findByIdAndUpdate(tenantId, update, { new: true });
        console.log(
          `✅ Tenant ${tenantId} updated after checkout.session.completed`
        );
      }
    }

    // Update status when invoice payment succeeds
    if (type === "invoice.paid") {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;
      if (subscriptionId) {
        await Tenant.findOneAndUpdate(
          { stripeSubscriptionId: subscriptionId },
          { subscriptionStatus: "active" }
        );
      }
    }

    // Payment failed
    if (type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;
      if (subscriptionId) {
        await Tenant.findOneAndUpdate(
          { stripeSubscriptionId: subscriptionId },
          { subscriptionStatus: "past_due" }
        );
      }
    }

    // Subscription updated (plan change / cancel)
    if (
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      const subscriptionId = subscription.id;
      const status = subscription.status; // active, past_due, canceled, incomplete

      // Try to map price -> planKey if possible
      let planKey = null;
      if (
        subscription.items &&
        subscription.items.data &&
        subscription.items.data[0]
      ) {
        const unitAmount = subscription.items.data[0].price.unit_amount;
        planKey =
          Object.keys(PLANS).find((k) => PLANS[k].priceCents === unitAmount) ||
          null;
      }

      const update = { subscriptionStatus: status };
      if (planKey) {
        update.planKey = planKey;
        update.seatLimit = PLANS[planKey].seats;
      }

      await Tenant.findOneAndUpdate(
        { stripeSubscriptionId: subscriptionId },
        update
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Error handling webhook:", err);
    res.status(500).send();
  }
};
