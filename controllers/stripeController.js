/**
 * Billing
 * -------
 * Plans: Free (default) → optional 14-day Pro trial (no card, in our DB) →
 * paid Pro or Facility through Stripe Checkout, monthly or yearly.
 *
 * Prices live in Stripe; we only keep their Price IDs in env:
 *   STRIPE_PRICE_PRO_MONTHLY, STRIPE_PRICE_PRO_YEARLY,
 *   STRIPE_PRICE_FACILITY_MONTHLY, STRIPE_PRICE_FACILITY_YEARLY
 * Founding price: STRIPE_FOUNDING_COUPON_ID ($20 off forever, Pro monthly,
 * first FOUNDING_SPOTS workspaces).
 */
const Stripe = require("stripe");
const Tenant = require("../models/tenantModel");
const {
  PLANS,
  PAID_PLAN_KEYS,
  PAID_STATUSES,
  TRIAL_DAYS,
  DAY_MS,
  getEffectivePlanKey,
  trialAvailable,
  describePlan,
  isPaid,
} = require("../config/plans");
const {
  countActiveStaff,
  countSchedulers,
} = require("../utils/planLimits");

// Use env key but allow a fallback dummy to avoid crashes in dev without env set
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_dummy_key");

const FOUNDING_SPOTS = 20;
const INTERVALS = ["month", "year"];
// Display prices (cents). Stripe is the source of truth for what's charged.
const LIST_PRICES_CENTS = {
  "pro:month": 4900,
  "pro:year": 49000,
  "facility:month": 17900,
  "facility:year": 179000,
};
const FOUNDING_PRO_MONTHLY_CENTS = 2900;

const frontendUrl = (
  process.env.FRONTEND_URL || "http://localhost:5173"
).replace(/\/+$/, "");

const priceEnvName = (plan, interval) =>
  `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "YEARLY" : "MONTHLY"}`;

/** Stripe Price ID for a plan + interval, read from env at call time. */
const getPriceId = (plan, interval) =>
  process.env[priceEnvName(plan, interval)] || null;

/** Reverse lookup: Stripe Price ID → { plan, interval }. */
const planFromPriceId = (priceId) => {
  if (!priceId) return null;
  for (const plan of PAID_PLAN_KEYS) {
    for (const interval of INTERVALS) {
      if (getPriceId(plan, interval) === priceId) return { plan, interval };
    }
  }
  return null;
};

const getFoundingSpotsLeft = async () =>
  Math.max(
    0,
    FOUNDING_SPOTS - (await Tenant.countDocuments({ foundingMember: true })),
  );

const qualifiesForFounding = (plan, interval, spotsLeft) =>
  plan === "pro" &&
  interval === "month" &&
  spotsLeft > 0 &&
  Boolean(process.env.STRIPE_FOUNDING_COUPON_ID);

const validatePlanChoice = (plan, interval) => {
  if (!PAID_PLAN_KEYS.includes(plan)) {
    return `plan must be one of: ${PAID_PLAN_KEYS.join(", ")}`;
  }
  if (!INTERVALS.includes(interval)) {
    return `interval must be one of: ${INTERVALS.join(", ")}`;
  }
  return null;
};

const billingNotConfigured = (res, plan, interval) =>
  res.status(500).json({
    message: `Billing is not configured: missing ${priceEnvName(plan, interval)}`,
    errorCode: "BILLING_NOT_CONFIGURED",
  });

/** Usage vs a target plan; returns the first limit that would be exceeded. */
const findLimitBreach = async (tenantId, planKey) => {
  const plan = PLANS[planKey];
  const [staff, schedulers] = await Promise.all([
    countActiveStaff(tenantId),
    countSchedulers(tenantId),
  ]);
  if (staff > plan.staff)
    return { kind: "staff", used: staff, limit: plan.staff };
  if (schedulers > plan.schedulers)
    return { kind: "schedulers", used: schedulers, limit: plan.schedulers };
  return null;
};

// Newer Stripe API versions moved invoice.subscription under `parent`.
const getInvoiceSubscriptionId = (invoice) =>
  invoice.subscription ||
  invoice.parent?.subscription_details?.subscription ||
  null;

/**
 * GET /api/v1/stripe/plans
 * Catalog + where this workspace stands.
 */
exports.getPlans = async (req, res, next) => {
  try {
    const tenant = req.tenant;
    const [staff, schedulers, foundingSpotsLeft] = await Promise.all([
      countActiveStaff(req.tenantId),
      countSchedulers(req.tenantId),
      getFoundingSpotsLeft(),
    ]);
    const effectivePlan = getEffectivePlanKey(tenant);
    const effective = PLANS[effectivePlan];

    res.status(200).json({
      currentPlan: tenant.plan,
      effectivePlan,
      billingInterval: tenant.billingInterval,
      subscriptionStatus: tenant.subscriptionStatus,
      foundingMember: tenant.foundingMember,
      trialAvailable: trialAvailable(tenant),
      trialEndsAt: tenant.trialEndsAt,
      foundingSpotsLeft,
      usage: {
        staff,
        schedulers,
        overLimit:
          staff > effective.staff || schedulers > effective.schedulers,
      },
      plans: Object.keys(PLANS).map((key) => ({
        ...describePlan(key),
        prices:
          key === "pro" || key === "facility"
            ? {
                month: LIST_PRICES_CENTS[`${key}:month`],
                year: LIST_PRICES_CENTS[`${key}:year`],
              }
            : null,
        foundingPrice:
          key === "pro" && foundingSpotsLeft > 0
            ? { month: FOUNDING_PRO_MONTHLY_CENTS }
            : null,
        purchasable: PAID_PLAN_KEYS.includes(key),
      })),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/billing/start-trial
 * Starts the one-time, no-card Pro trial.
 */
exports.startTrial = async (req, res, next) => {
  try {
    const tenant = req.tenant;
    if (isPaid(tenant)) {
      return res.status(409).json({
        message: "You already have a paid plan",
        errorCode: "ALREADY_PAID",
      });
    }
    if (!trialAvailable(tenant)) {
      return res.status(409).json({
        message: "Your free trial has already been used",
        errorCode: "TRIAL_ALREADY_USED",
      });
    }

    const now = new Date();
    tenant.trialUsedAt = now;
    tenant.trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
    await tenant.save();

    res.status(200).json({
      message: `Your ${TRIAL_DAYS}-day Pro trial has started`,
      effectivePlan: getEffectivePlanKey(tenant),
      trialEndsAt: tenant.trialEndsAt,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/stripe/create-checkout-session
 * Body: { plan: "pro" | "facility", interval: "month" | "year" }
 */
exports.createCheckoutSession = async (req, res, next) => {
  try {
    const { plan, interval = "month" } = req.body || {};
    const tenant = req.tenant;
    const tenantId = String(tenant._id);

    const choiceError = validatePlanChoice(plan, interval);
    if (choiceError) return res.status(400).json({ message: choiceError });

    const price = getPriceId(plan, interval);
    if (!price) return billingNotConfigured(res, plan, interval);

    if (
      tenant.stripeSubscriptionId &&
      PAID_STATUSES.includes(tenant.subscriptionStatus)
    ) {
      return res.status(409).json({
        message:
          "This workspace already has a subscription. Use change-plan to switch plans.",
        errorCode: "SUBSCRIPTION_ALREADY_ACTIVE",
        subscriptionStatus: tenant.subscriptionStatus,
        plan: tenant.plan,
      });
    }

    const breach = await findLimitBreach(tenantId, plan);
    if (breach) {
      return res.status(409).json({
        message: `The ${PLANS[plan].label} plan allows ${breach.limit} ${breach.kind}; you have ${breach.used}.`,
        errorCode: "PLAN_BELOW_USAGE",
        ...breach,
      });
    }

    const founding = qualifiesForFounding(
      plan,
      interval,
      await getFoundingSpotsLeft(),
    );
    const metadata = {
      tenantId,
      plan,
      interval,
      ...(founding ? { founding: "1" } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      client_reference_id: tenantId,
      metadata,
      // Reusing the saved customer keeps billing history on one customer.
      ...(tenant.stripeCustomerId
        ? { customer: tenant.stripeCustomerId }
        : tenant.billingEmail || tenant.email
          ? { customer_email: tenant.billingEmail || tenant.email }
          : {}),
      ...(founding
        ? { discounts: [{ coupon: process.env.STRIPE_FOUNDING_COUPON_ID }] }
        : { allow_promotion_codes: true }),
      // No trial_period_days: the Pro trial lives in our DB, not Stripe.
      subscription_data: { metadata },
      success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/billing/cancel`,
    });

    res.status(200).json({ url: session.url, id: session.id, founding });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/stripe/change-plan
 * Body: { plan, interval } — switches the existing subscription in place.
 */
exports.changePlan = async (req, res, next) => {
  try {
    const { plan, interval = "month" } = req.body || {};
    const tenant = req.tenant;

    const choiceError = validatePlanChoice(plan, interval);
    if (choiceError) return res.status(400).json({ message: choiceError });

    const price = getPriceId(plan, interval);
    if (!price) return billingNotConfigured(res, plan, interval);

    if (
      !tenant.stripeSubscriptionId ||
      !PAID_STATUSES.includes(tenant.subscriptionStatus)
    ) {
      return res.status(409).json({
        message:
          "This workspace has no active subscription to change. Start a checkout instead.",
        errorCode: "NO_ACTIVE_SUBSCRIPTION",
      });
    }

    if (tenant.plan === plan && tenant.billingInterval === interval) {
      return res
        .status(400)
        .json({ message: "You're already on this plan" });
    }

    const breach = await findLimitBreach(tenant._id, plan);
    if (breach) {
      return res.status(409).json({
        message: `The ${PLANS[plan].label} plan allows ${breach.limit} ${breach.kind}; you have ${breach.used}. Archive some first or pick a bigger plan.`,
        errorCode: "PLAN_BELOW_USAGE",
        ...breach,
      });
    }

    const subscription = await stripe.subscriptions.retrieve(
      tenant.stripeSubscriptionId,
    );
    const currentItem = subscription.items?.data?.[0];
    if (!currentItem) {
      return res.status(409).json({
        message: "Subscription has no billable item to update",
        errorCode: "SUBSCRIPTION_ITEM_MISSING",
      });
    }

    const updated = await stripe.subscriptions.update(
      tenant.stripeSubscriptionId,
      {
        items: [{ id: currentItem.id, price }],
        proration_behavior: "create_prorations",
        metadata: { tenantId: String(tenant._id), plan, interval },
      },
    );

    tenant.plan = plan;
    tenant.billingInterval = interval;
    tenant.stripePriceId = price;
    tenant.subscriptionStatus = updated.status;
    await tenant.save();

    res.status(200).json({
      success: true,
      plan,
      interval,
      subscriptionStatus: updated.status,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/stripe/portal
 * Stripe customer portal: invoices, payment method, cancel.
 */
exports.createPortalSession = async (req, res, next) => {
  try {
    const tenant = req.tenant;
    if (!tenant.stripeCustomerId) {
      return res.status(409).json({
        message: "No billing account yet. Choose a plan first.",
        errorCode: "NO_BILLING_ACCOUNT",
      });
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId,
      return_url: `${frontendUrl}/settings/billing`,
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/stripe/cancel-subscription
 * Body: { atPeriodEnd?: boolean } (default true). The portal can also cancel.
 */
exports.cancelSubscription = async (req, res, next) => {
  try {
    const tenant = req.tenant;
    const atPeriodEnd = req.body?.atPeriodEnd !== false;

    if (!tenant.stripeSubscriptionId) {
      return res
        .status(400)
        .json({ message: "This workspace has no subscription" });
    }

    const subscription = atPeriodEnd
      ? await stripe.subscriptions.update(tenant.stripeSubscriptionId, {
          cancel_at_period_end: true,
        })
      : await stripe.subscriptions.cancel(tenant.stripeSubscriptionId);

    if (subscription.status === "canceled") {
      tenant.plan = "free";
      tenant.billingInterval = null;
      tenant.stripeSubscriptionId = null;
      tenant.stripePriceId = null;
    }
    tenant.subscriptionStatus = subscription.status;
    await tenant.save();

    res.status(200).json({
      success: true,
      subscriptionStatus: subscription.status,
      cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Build the tenant update for a subscription object (used by webhooks).
 * Exported for tests.
 */
const buildSubscriptionUpdate = (subscription) => {
  const update = { subscriptionStatus: subscription.status };
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const mapped = planFromPriceId(priceId);
  if (mapped) {
    update.plan = mapped.plan;
    update.billingInterval = mapped.interval;
    update.stripePriceId = priceId;
  }
  if (subscription.status === "canceled") {
    update.plan = "free";
    update.billingInterval = null;
    update.stripeSubscriptionId = null;
    update.stripePriceId = null;
  }
  return update;
};

/**
 * Stripe webhook.
 */
exports.handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_test_dummy";

  let event;
  try {
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

    if (type === "checkout.session.completed") {
      const session = event.data.object;
      const tenantId = session.metadata?.tenantId;
      if (tenantId && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription,
        );
        const update = {
          ...buildSubscriptionUpdate(subscription),
          billingEmail:
            session.customer_details?.email || session.customer_email || null,
          stripeCustomerId: session.customer || null,
          stripeSubscriptionId: session.subscription,
        };
        // Fall back to metadata if the Price ID isn't mapped in env.
        if (!update.plan && PAID_PLAN_KEYS.includes(session.metadata.plan)) {
          update.plan = session.metadata.plan;
          update.billingInterval = session.metadata.interval || null;
        }
        if (session.metadata.founding === "1") update.foundingMember = true;

        await Tenant.findByIdAndUpdate(tenantId, update);
        console.log(`✅ Tenant ${tenantId} subscribed (${update.plan})`);
      }
    }

    if (type === "invoice.paid" || type === "invoice.payment_failed") {
      const subscriptionId = getInvoiceSubscriptionId(event.data.object);
      if (subscriptionId) {
        await Tenant.findOneAndUpdate(
          { stripeSubscriptionId: subscriptionId },
          {
            subscriptionStatus: type === "invoice.paid" ? "active" : "past_due",
          },
        );
      }
    }

    if (
      type === "customer.subscription.updated" ||
      type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      const update = buildSubscriptionUpdate(
        type === "customer.subscription.deleted"
          ? { ...subscription, status: "canceled" }
          : subscription,
      );
      await Tenant.findOneAndUpdate(
        { stripeSubscriptionId: subscription.id },
        update,
      );
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Error handling webhook:", err);
    res.status(500).send();
  }
};

// Exposed for unit tests.
exports._planFromPriceId = planFromPriceId;
exports._buildSubscriptionUpdate = buildSubscriptionUpdate;
exports._qualifiesForFounding = qualifiesForFounding;
