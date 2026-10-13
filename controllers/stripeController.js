/**
 * Billing
 * -------
 * Plans: Free (default) → optional 14-day Starter trial (no card, in our DB)
 * → Starter, Growth or Premium through Stripe Checkout, monthly or yearly.
 * The first checkout gets a card trial: 7 days monthly, 30 days yearly
 * (skipped if the in-app trial was already used). Enterprise is sales-led.
 *
 * Prices come from PLAN_PRICES in config/plans.js: checkout sends the amount
 * inline (price_data), so nothing has to be created in Stripe or added to
 * env. Optional: set STRIPE_PRICE_{STARTER,GROWTH,PREMIUM}_{MONTHLY,YEARLY}
 * to use Prices you made in the Stripe dashboard instead.
 */
const Stripe = require("stripe");
const Tenant = require("../models/tenantModel");
const {
  PLANS,
  PAID_PLAN_KEYS,
  PAID_STATUSES,
  PLAN_PRICES,
  TRIAL_PLAN,
  CHECKOUT_TRIAL_DAYS,
  normalizePlanKey,
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

const INTERVALS = ["month", "year"];

const frontendUrl = (
  process.env.FRONTEND_URL || "http://localhost:5173"
).replace(/\/+$/, "");

const priceEnvName = (plan, interval) =>
  `STRIPE_PRICE_${plan.toUpperCase()}_${interval === "year" ? "YEARLY" : "MONTHLY"}`;

/** Stripe Price ID for a plan + interval, read from env at call time. */
const getPriceId = (plan, interval) =>
  process.env[priceEnvName(plan, interval)] || null;

/** What to charge: a dashboard Price if configured, else the amount inline. */
const priceSpecFor = (plan, interval) => {
  const priceId = getPriceId(plan, interval);
  if (priceId) return { price: priceId };
  return {
    price_data: {
      currency: "usd",
      product_data: { name: `WiserShifts ${PLANS[plan].label}` },
      unit_amount: PLAN_PRICES[plan][interval],
      recurring: { interval },
    },
  };
};

/** A Price ID for subscription updates (which can't take product_data). */
const ensurePriceId = async (plan, interval) => {
  const configured = getPriceId(plan, interval);
  if (configured) return configured;
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: PLAN_PRICES[plan][interval],
    recurring: { interval },
    product_data: { name: `WiserShifts ${PLANS[plan].label}` },
    metadata: { plan, interval },
  });
  return price.id;
};

/** Plan from an amount + interval (for inline prices). */
const planFromAmount = (unitAmount, interval) => {
  for (const plan of PAID_PLAN_KEYS) {
    if (PLAN_PRICES[plan]?.[interval] === unitAmount) return { plan, interval };
  }
  return null;
};

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

/** The card trial at checkout is for workspaces that never trialed. */
const checkoutTrialDays = (tenant, interval) =>
  tenant.trialUsedAt || tenant.cardTrialUsedAt || tenant.stripeSubscriptionId
    ? 0
    : CHECKOUT_TRIAL_DAYS[interval] || 0;

const validatePlanChoice = (plan, interval) => {
  if (!PAID_PLAN_KEYS.includes(plan)) {
    return `plan must be one of: ${PAID_PLAN_KEYS.join(", ")}`;
  }
  if (!INTERVALS.includes(interval)) {
    return `interval must be one of: ${INTERVALS.join(", ")}`;
  }
  return null;
};

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

// "Growth allows 5 schedulers; you have 9. Make 4 of them viewers, or
// choose Premium." — what to do about it, not just the numbers.
const breachMessage = (planKey, breach, usage) => {
  const plan = PLANS[planKey];
  const extra = breach.used - breach.limit;
  const fix =
    breach.kind === "schedulers"
      ? `make ${extra} of them viewer${extra === 1 ? "" : "s"} under Schedulers & viewers`
      : `archive ${extra} under Staff`;
  const bigger = PAID_PLAN_KEYS.find(
    (key) => PLANS[key].staff >= usage.staff && PLANS[key].schedulers >= usage.schedulers,
  );
  return `${plan.label} allows ${breach.limit} ${breach.kind}; you have ${breach.used}. To switch, ${fix}${
    bigger && bigger !== planKey ? `, or choose ${PLANS[bigger].label}` : ""
  }.`;
};

const usageFor = async (tenantId) => {
  const [staff, schedulers] = await Promise.all([
    countActiveStaff(tenantId),
    countSchedulers(tenantId),
  ]);
  return { staff, schedulers };
};

// Switch an existing Stripe subscription to another plan, in place.
const switchSubscriptionPlan = async (tenant, plan, interval, subscription) => {
  const currentItem = subscription.items?.data?.[0];
  if (!currentItem) {
    const err = new Error("Subscription has no billable item to update");
    err.statusCode = 409;
    throw err;
  }
  const price = await ensurePriceId(plan, interval);
  const updated = await stripe.subscriptions.update(subscription.id, {
    items: [{ id: currentItem.id, price }],
    proration_behavior: "create_prorations",
    metadata: { tenantId: String(tenant._id), plan, interval },
  });
  tenant.plan = plan;
  tenant.billingInterval = interval;
  tenant.stripePriceId = price;
  tenant.subscriptionStatus = updated.status;
  await tenant.save();
  return updated;
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
    const [staff, schedulers] = await Promise.all([
      countActiveStaff(req.tenantId),
      countSchedulers(req.tenantId),
    ]);
    const effectivePlan = getEffectivePlanKey(tenant);
    const effective = PLANS[effectivePlan];

    res.status(200).json({
      currentPlan: normalizePlanKey(tenant.plan),
      effectivePlan,
      billingInterval: tenant.billingInterval,
      subscriptionStatus: tenant.subscriptionStatus,
      trialAvailable: trialAvailable(tenant),
      trialPlan: TRIAL_PLAN,
      trialDays: TRIAL_DAYS,
      trialEndsAt: tenant.trialEndsAt,
      checkoutTrialDays: {
        month: checkoutTrialDays(tenant, "month"),
        year: checkoutTrialDays(tenant, "year"),
      },
      usage: {
        staff,
        schedulers,
        overLimit:
          staff > effective.staff || schedulers > effective.schedulers,
      },
      plans: Object.keys(PLANS).map((key) => {
        const limits = PLANS[key];
        const overStaff = Math.max(0, staff - limits.staff);
        const overSchedulers = Math.max(0, schedulers - limits.schedulers);
        return {
          ...describePlan(key),
          prices: PLAN_PRICES[key] || null,
          purchasable: PAID_PLAN_KEYS.includes(key),
          contactSales: key === "enterprise",
          fitsUsage: !overStaff && !overSchedulers,
          over: { staff: overStaff, schedulers: overSchedulers },
        };
      }),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/billing/start-trial
 * Starts the one-time, no-card Starter trial.
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
      message: `Your ${TRIAL_DAYS}-day ${PLANS[TRIAL_PLAN].label} trial has started`,
      effectivePlan: getEffectivePlanKey(tenant),
      trialEndsAt: tenant.trialEndsAt,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/stripe/create-checkout-session
 * Body: { plan: "starter" | "growth" | "premium", interval: "month" | "year" }
 */
exports.createCheckoutSession = async (req, res, next) => {
  try {
    const { plan, interval = "month" } = req.body || {};
    const tenant = req.tenant;
    const tenantId = String(tenant._id);

    const choiceError = validatePlanChoice(plan, interval);
    if (choiceError) return res.status(400).json({ message: choiceError });

    const breach = await findLimitBreach(tenantId, plan);
    if (breach) {
      return res.status(409).json({
        message: breachMessage(plan, breach, await usageFor(tenantId)),
        errorCode: "PLAN_BELOW_USAGE",
        ...breach,
      });
    }

    // Already subscribed? Check with Stripe (our copy can be stale, e.g.
    // after a cancellation we didn't hear about, or older data).
    if (tenant.stripeSubscriptionId) {
      let live = null;
      try {
        live = await stripe.subscriptions.retrieve(tenant.stripeSubscriptionId);
      } catch (err) {
        if (err?.statusCode !== 404 && err?.code !== "resource_missing") throw err;
      }
      if (live && PAID_STATUSES.includes(live.status)) {
        // Switch the existing subscription instead of starting a second one.
        if (normalizePlanKey(tenant.plan) === plan && tenant.billingInterval === interval && tenant.subscriptionStatus === live.status) {
          return res.status(400).json({ message: "You're already on this plan" });
        }
        const updated = await switchSubscriptionPlan(tenant, plan, interval, live);
        return res.status(200).json({
          changed: true,
          plan,
          interval,
          subscriptionStatus: updated.status,
        });
      }
      // It ended in Stripe: forget it and start a fresh checkout.
      tenant.stripeSubscriptionId = null;
      tenant.subscriptionStatus = live?.status || "canceled";
      await tenant.save();
    }

    const trialDays = checkoutTrialDays(tenant, interval);
    const metadata = {
      tenantId,
      plan,
      interval,
      ...(trialDays ? { cardTrial: String(trialDays) } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ ...priceSpecFor(plan, interval), quantity: 1 }],
      client_reference_id: tenantId,
      metadata,
      // Reusing the saved customer keeps billing history on one customer.
      ...(tenant.stripeCustomerId
        ? { customer: tenant.stripeCustomerId }
        : tenant.billingEmail || tenant.email
          ? { customer_email: tenant.billingEmail || tenant.email }
          : {}),
      allow_promotion_codes: true,
      subscription_data: {
        metadata,
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
      success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/billing/cancel`,
    });

    res.status(200).json({ url: session.url, id: session.id, trialDays });
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
        message: breachMessage(plan, breach, await usageFor(tenant._id)),
        errorCode: "PLAN_BELOW_USAGE",
        ...breach,
      });
    }

    const subscription = await stripe.subscriptions.retrieve(
      tenant.stripeSubscriptionId,
    );
    const updated = await switchSubscriptionPlan(tenant, plan, interval, subscription);

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
      return_url: `${frontendUrl}/billing`,
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
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id || null;
  // Dashboard Price ID → subscription metadata (set at checkout / change) →
  // amount + interval (inline prices).
  const metaPlan = subscription.metadata?.plan;
  const metaInterval = subscription.metadata?.interval;
  const mapped =
    planFromPriceId(priceId) ||
    (PAID_PLAN_KEYS.includes(metaPlan) && ["month", "year"].includes(metaInterval)
      ? { plan: metaPlan, interval: metaInterval }
      : null) ||
    planFromAmount(item?.price?.unit_amount, item?.price?.recurring?.interval);
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
        if (session.metadata.cardTrial) update.cardTrialUsedAt = new Date();

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
exports._priceSpecFor = priceSpecFor;
exports._buildSubscriptionUpdate = buildSubscriptionUpdate;
exports._breachMessage = breachMessage;
exports._checkoutTrialDays = checkoutTrialDays;
