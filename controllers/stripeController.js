const Stripe = require("stripe");
const Tenant = require("../models/tenantModel");
const User = require("../models/userModel");

// Use env key but allow a fallback dummy to avoid crashes in dev without env set
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key");

// Plan mapping: planKey -> price (cents) and seats
// Prices are in cents: $3000 -> 300000 cents
const yearlyStarterPriceCents = 400000;
const yearlyGrowthPriceCents = 700000;
const yearlyPremiumPriceCents = 900000;
const monthlyStarterPriceCents = 50000;
const monthlyGrowthPriceCents = 80000;
const monthlyPremiumPriceCents = 100000;

// Trial length per billing interval. Set to 0 to disable a trial for that interval.
const TRIAL_DAYS_BY_INTERVAL = {
  year: 30,
  month: 7,
};

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];
const frontendUrl = (
  process.env.FRONTEND_URL || "http://localhost:5173"
).replace(/\/+$/, "");

const PLANS = {
  starterYearly: {
    priceCents: yearlyStarterPriceCents,
    seats: 50,
    name: "Starter Yearly",
  },
  growthYearly: {
    priceCents: yearlyGrowthPriceCents,
    seats: 100,
    name: "Growth Yearly",
  },
  premiumYearly: {
    priceCents: yearlyPremiumPriceCents,
    seats: 150,
    name: "Premium Yearly",
  },
  starterMonthly: {
    priceCents: monthlyStarterPriceCents,
    seats: 50,
    name: "Starter Monthly",
  },
  growthMonthly: {
    priceCents: monthlyGrowthPriceCents,
    seats: 100,
    name: "Growth Monthly",
  },
  premiumMonthly: {
    priceCents: monthlyPremiumPriceCents,
    seats: 150,
    name: "Premium Monthly",
  },
  // test: { priceCents: 200, seats: 12, name: "Test" },
};

const intervalFromPlanKey = (planKey) =>
  planKey && planKey.toLowerCase().endsWith("monthly") ? "month" : "year";

// A tenant gets exactly one free trial, ever — not one per plan or per resubscribe.
const getTrialPeriodDays = (tenant, planKey) => {
  if (tenant.trialUsedAt) return 0;
  return TRIAL_DAYS_BY_INTERVAL[intervalFromPlanKey(planKey)] || 0;
};

// A seat is any user with a login in the tenant.
const getSeatsInUse = (tenantId) => User.countDocuments({ tenantId });

const buildPlanOption = (planKey, seatsInUse, trialAvailable) => {
  const plan = PLANS[planKey];
  return {
    planKey,
    name: plan.name,
    priceCents: plan.priceCents,
    seats: plan.seats,
    interval: intervalFromPlanKey(planKey),
    trialPeriodDays: trialAvailable
      ? TRIAL_DAYS_BY_INTERVAL[intervalFromPlanKey(planKey)] || 0
      : 0,
    available: plan.seats >= seatsInUse,
    seatsOverLimit: Math.max(0, seatsInUse - plan.seats),
  };
};

/**
 * Plan catalog with per-tenant availability so the UI can disable plans that
 * are smaller than the tenant's current staff count.
 */
exports.getPlans = async (req, res, next) => {
  try {
    const tenantId = req.tenantId || (req.user && req.user.tenantId);
    if (!tenantId)
      return res.status(400).json({ message: "Tenant context required" });

    const tenant = await Tenant.findById(tenantId).select(
      "planKey subscriptionStatus trialUsedAt seatLimit",
    );
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const seatsInUse = await getSeatsInUse(tenantId);
    const trialAvailable = !tenant.trialUsedAt;

    res.status(200).json({
      seatsInUse,
      seatLimit: tenant.seatLimit,
      currentPlanKey: tenant.planKey,
      subscriptionStatus: tenant.subscriptionStatus,
      trialAvailable,
      plans: Object.keys(PLANS).map((planKey) =>
        buildPlanOption(planKey, seatsInUse, trialAvailable),
      ),
    });
  } catch (err) {
    next(err);
  }
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

    if (
      tenant.stripeSubscriptionId &&
      ACTIVE_SUBSCRIPTION_STATUSES.includes(tenant.subscriptionStatus)
    ) {
      return res.status(409).json({
        message:
          "This tenant already has a subscription. Use the change-plan endpoint to switch plans, or cancel the current plan first.",
        errorCode: "SUBSCRIPTION_ALREADY_ACTIVE",
        subscriptionStatus: tenant.subscriptionStatus,
        planKey: tenant.planKey,
      });
    }

    const trialPeriodDays = getTrialPeriodDays(tenant, planKey);

    const seatsInUse = await getSeatsInUse(tenantId);
    if (plan.seats < seatsInUse) {
      return res.status(409).json({
        message: `This plan includes ${plan.seats} seats but your facility has ${seatsInUse} staff members. Choose a larger plan or remove ${seatsInUse - plan.seats} staff member(s) before subscribing.`,
        errorCode: "PLAN_SEATS_BELOW_USAGE",
        seatsInUse,
        planSeats: plan.seats,
        seatsOverLimit: seatsInUse - plan.seats,
        availablePlans: Object.keys(PLANS)
          .filter(
            (key) =>
              PLANS[key].seats >= seatsInUse &&
              intervalFromPlanKey(key) === intervalFromPlanKey(planKey),
          )
          .map((key) => buildPlanOption(key, seatsInUse, trialPeriodDays > 0)),
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `${plan.name} plan (WiserShifts)` },
            recurring: { interval: intervalFromPlanKey(planKey) },
            unit_amount: plan.priceCents,
          },
          quantity: 1,
        },
      ],
      client_reference_id: tenantId,
      metadata: { tenantId, planKey },
      // Reusing the saved customer keeps billing history on one Stripe customer
      // so a returning tenant can't start over with a fresh trial.
      ...(tenant.stripeCustomerId
        ? { customer: tenant.stripeCustomerId }
        : tenant.billingEmail
          ? { customer_email: tenant.billingEmail }
          : {}),
      // Ensure the subscription object itself carries tenant metadata so future
      // subscription/invoice webhooks can directly reference tenantId.
      subscription_data: {
        ...(trialPeriodDays > 0 ? { trial_period_days: trialPeriodDays } : {}),
        metadata: { tenantId, planKey },
      },
      success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/billing/cancel`,
    });

    res.status(200).json({
      url: session.url,
      id: session.id,
      trialPeriodDays,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Switch an existing subscription to a different plan in place.
 * Body params: { planKey }
 *
 * Updating the subscription item keeps the current trial_end and Stripe
 * customer, so a tenant can upgrade mid-trial without losing remaining
 * trial days or burning their one-time trial.
 */
exports.changePlan = async (req, res, next) => {
  try {
    const { planKey } = req.body;
    const tenantId = req.tenantId || (req.user && req.user.tenantId);

    if (!tenantId)
      return res.status(400).json({ message: "Tenant context required" });
    if (!planKey)
      return res.status(400).json({ message: "planKey is required" });

    const plan = PLANS[planKey];
    if (!plan) return res.status(400).json({ message: "Invalid planKey" });

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    if (
      !tenant.stripeSubscriptionId ||
      !ACTIVE_SUBSCRIPTION_STATUSES.includes(tenant.subscriptionStatus)
    ) {
      return res.status(409).json({
        message:
          "This tenant has no active subscription to change. Start a new checkout instead.",
        errorCode: "NO_ACTIVE_SUBSCRIPTION",
      });
    }

    if (tenant.planKey === planKey) {
      return res
        .status(400)
        .json({ message: "Tenant is already on this plan" });
    }

    const seatsInUse = await getSeatsInUse(tenantId);
    if (plan.seats < seatsInUse) {
      return res.status(409).json({
        message: `This plan includes ${plan.seats} seats but your facility has ${seatsInUse} staff members. Choose a larger plan or remove ${seatsInUse - plan.seats} staff member(s) before switching.`,
        errorCode: "PLAN_SEATS_BELOW_USAGE",
        seatsInUse,
        planSeats: plan.seats,
        seatsOverLimit: seatsInUse - plan.seats,
        availablePlans: Object.keys(PLANS)
          .filter((key) => PLANS[key].seats >= seatsInUse)
          .map((key) => buildPlanOption(key, seatsInUse, false)),
      });
    }

    const subscription = await stripe.subscriptions.retrieve(
      tenant.stripeSubscriptionId,
    );
    const currentItem =
      subscription.items &&
      subscription.items.data &&
      subscription.items.data[0];

    if (!currentItem) {
      return res.status(409).json({
        message: "Subscription has no billable item to update",
        errorCode: "SUBSCRIPTION_ITEM_MISSING",
      });
    }

    // Subscription items require a real Price id, so mint one for the target plan.
    const price = await stripe.prices.create({
      currency: "usd",
      unit_amount: plan.priceCents,
      recurring: { interval: intervalFromPlanKey(planKey) },
      product_data: { name: `${plan.name} plan (WiserShifts)` },
    });

    const updated = await stripe.subscriptions.update(
      tenant.stripeSubscriptionId,
      {
        items: [{ id: currentItem.id, price: price.id }],
        // Omitting trial_end preserves any trial still running.
        proration_behavior: "create_prorations",
        metadata: { tenantId: String(tenantId), planKey },
      },
    );

    await Tenant.findByIdAndUpdate(tenantId, {
      planKey,
      seatLimit: plan.seats,
      stripePriceId: price.id,
      subscriptionStatus: updated.status,
    });

    res.status(200).json({
      success: true,
      planKey,
      seatLimit: plan.seats,
      subscriptionStatus: updated.status,
      trialEnd: updated.trial_end
        ? new Date(updated.trial_end * 1000).toISOString()
        : null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Cancel a subscription for the current tenant (admin only).
 * Body params: { subscriptionId?, atPeriodEnd?: boolean }
 * If subscriptionId is not provided, the tenant's stripeSubscriptionId is used.
 */
exports.cancelSubscription = async (req, res, next) => {
  try {
    const atPeriodEnd =
      req.body.atPeriodEnd === true || req.query.atPeriodEnd === "true";

    // Expect tenant middleware to have set req.tenantId for protected routes
    const tenantId = req.tenantId || (req.user && req.user.tenantId);
    if (!tenantId)
      return res.status(400).json({ message: "Tenant context required" });

    const requestedSubscriptionId = req.body.subscriptionId || null;

    // Load tenant to find subscription if not passed
    const tenant = await Tenant.findById(tenantId);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const subscriptionId =
      requestedSubscriptionId || tenant.stripeSubscriptionId;
    if (!subscriptionId)
      return res
        .status(400)
        .json({ message: "No subscriptionId provided or found for tenant" });

    let subscription;
    if (atPeriodEnd) {
      subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    } else {
      subscription = await stripe.subscriptions.del(subscriptionId);
    }

    // Prepare tenant update based on result
    const update = {
      subscriptionStatus:
        subscription.status ||
        (subscription.cancel_at_period_end ? "active" : undefined),
    };

    // If fully canceled, clear plan and subscription fields
    if (!atPeriodEnd && subscription.status === "canceled") {
      update.planKey = null;
      update.seatLimit = 1;
      update.stripeSubscriptionId = null;
      update.stripePriceId = null;
    }

    await Tenant.findByIdAndUpdate(tenantId, update, { new: true });

    res.status(200).json({ success: true, subscription });
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
          subscriptionStatus: (subscription && subscription.status) || "active",
          seatLimit: plan ? plan.seats : undefined,
        };

        if (
          subscription &&
          (subscription.trial_start || subscription.trial_end)
        ) {
          update.trialUsedAt = subscription.trial_start
            ? new Date(subscription.trial_start * 1000)
            : new Date();
        }

        // Remove undefined fields
        Object.keys(update).forEach(
          (k) => update[k] === undefined && delete update[k],
        );

        await Tenant.findByIdAndUpdate(tenantId, update, { new: true });
        console.log(
          `✅ Tenant ${tenantId} updated after checkout.session.completed`,
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
          { subscriptionStatus: "active" },
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
          { subscriptionStatus: "past_due" },
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
      const status = subscription.status; // active, trialing, past_due, canceled, incomplete

      // Try to map price -> planKey if possible
      let planKey = subscription.metadata && subscription.metadata.planKey;
      if (!planKey) {
        if (
          subscription.items &&
          subscription.items.data &&
          subscription.items.data[0]
        ) {
          const price = subscription.items.data[0].price;
          const unitAmount = price.unit_amount;
          const interval = price.recurring && price.recurring.interval;
          planKey =
            Object.keys(PLANS).find(
              (k) =>
                PLANS[k].priceCents === unitAmount &&
                intervalFromPlanKey(k) === interval,
            ) || null;
        }
      }

      const update = { subscriptionStatus: status };
      if (planKey) {
        update.planKey = planKey;
        update.seatLimit = PLANS[planKey].seats;
      }

      if (subscription.trial_start || subscription.trial_end) {
        update.trialUsedAt = subscription.trial_start
          ? new Date(subscription.trial_start * 1000)
          : new Date();
      }

      await Tenant.findOneAndUpdate(
        { stripeSubscriptionId: subscriptionId },
        update,
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Error handling webhook:", err);
    res.status(500).send();
  }
};
