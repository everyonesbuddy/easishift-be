/**
 * Plans — the single source of truth for limits and features.
 *
 * Everyone starts on Free. The owner can start a one-time, no-card 14-day
 * Starter trial in the app. Paid plans come from Stripe (tenant.plan +
 * subscriptionStatus); card checkouts get 7 (monthly) or 30 (yearly) trial
 * days the first time.
 *
 * Starter, Growth and Premium have the same features; they differ by staff,
 * schedulers and support. Enterprise adds branding and multiple facilities.
 */

// Paid features. Free gets the core: weekly needs, week schedule, areas and
// certifications, staff directory, publish by email, staff links, time off.
const FACILITY_FEATURES = [
  "sms",
  "swaps",
  "pickup",
  "calloutText",
  "import",
  "reminders",
  "autoFill",
  "timeClock",
  "timesheets",
  "messaging",
  "dashboard",
  // Weekly Needs from typed or spoken words (POST /nl/parse weeklyNeeds)
  "describeNeeds",
];

const PLANS = Object.freeze({
  free: { label: "Free", schedulers: 1, staff: 15, support: "help_docs", features: [] },
  starter: { label: "Starter", schedulers: 3, staff: 50, support: "standard", features: FACILITY_FEATURES },
  growth: { label: "Growth", schedulers: 5, staff: 100, support: "standard", features: FACILITY_FEATURES },
  premium: { label: "Premium", schedulers: 10, staff: 150, support: "priority", features: [...FACILITY_FEATURES, "prioritySupport"] },
  enterprise: {
    label: "Enterprise",
    schedulers: Infinity,
    staff: Infinity,
    support: "priority",
    features: [...FACILITY_FEATURES, "prioritySupport", "branding", "multiFacility"],
  },
});

// List prices in cents (what Stripe should be set to; shown on the plans page).
const PLAN_PRICES = Object.freeze({
  starter: { month: 50000, year: 480000 },
  growth: { month: 80000, year: 770000 },
  premium: { month: 100000, year: 960000 },
});

// Plans that can be bought through Stripe checkout.
const PAID_PLAN_KEYS = ["starter", "growth", "premium"];
const PLAN_ORDER = ["free", "starter", "growth", "premium", "enterprise"];
const PAID_STATUSES = ["active", "trialing", "past_due"];
const TRIAL_PLAN = "starter";
const TRIAL_DAYS = 14;
// Card trials at checkout (first subscription only).
const CHECKOUT_TRIAL_DAYS = Object.freeze({ month: 7, year: 30 });
// After a trial ends, one more week can be published while over the limits.
const GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Older plan keys (before Option A) read as their closest new plan.
const LEGACY_PLAN_KEYS = Object.freeze({
  pro: "starter",
  facility: "growth",
  organization: "enterprise",
});
const normalizePlanKey = (key) => LEGACY_PLAN_KEYS[key] || key;

const isPaid = (tenant) =>
  Boolean(tenant) &&
  tenant.plan &&
  tenant.plan !== "free" &&
  PAID_STATUSES.includes(tenant.subscriptionStatus);

const isTrialActive = (tenant, now = new Date()) =>
  Boolean(tenant?.trialEndsAt) && new Date(tenant.trialEndsAt) > now;

/** The plan the workspace actually gets right now. */
function getEffectivePlanKey(tenant, now = new Date()) {
  if (isPaid(tenant)) return normalizePlanKey(tenant.plan);
  if (isTrialActive(tenant, now)) return TRIAL_PLAN;
  return "free";
}

const getPlan = (rawKey) => {
  const key = PLANS[normalizePlanKey(rawKey)] ? normalizePlanKey(rawKey) : "free";
  return { key, ...PLANS[key] };
};

const hasFeature = (planKey, feature) =>
  Boolean(PLANS[normalizePlanKey(planKey)]?.features.includes(feature));

/** Cheapest plan that includes a feature (used in 402 responses). */
const requiredPlanFor = (feature) =>
  PLAN_ORDER.find((key) => hasFeature(key, feature)) || null;

/** One trial per workspace, and none while paying. */
const trialAvailable = (tenant) =>
  Boolean(tenant) && !tenant.trialUsedAt && !isPaid(tenant);

/** JSON-safe limits (Infinity becomes null = unlimited). */
const serializeLimit = (value) => (Number.isFinite(value) ? value : null);

const describePlan = (key) => {
  const plan = getPlan(key);
  return {
    key: plan.key,
    label: plan.label,
    limits: {
      staff: serializeLimit(plan.staff),
      schedulers: serializeLimit(plan.schedulers),
    },
    support: plan.support,
    features: plan.features,
  };
};

/** The trial ended (no paid plan) within the last GRACE_DAYS. */
const inPostTrialGrace = (tenant, now = new Date()) =>
  Boolean(tenant?.trialEndsAt) &&
  !isPaid(tenant) &&
  new Date(tenant.trialEndsAt) <= now &&
  now - new Date(tenant.trialEndsAt) < GRACE_DAYS * DAY_MS;

module.exports = {
  PLANS,
  PLAN_PRICES,
  PAID_PLAN_KEYS,
  TRIAL_PLAN,
  CHECKOUT_TRIAL_DAYS,
  GRACE_DAYS,
  normalizePlanKey,
  inPostTrialGrace,
  PLAN_ORDER,
  PAID_STATUSES,
  TRIAL_DAYS,
  DAY_MS,
  isPaid,
  isTrialActive,
  getEffectivePlanKey,
  getPlan,
  hasFeature,
  requiredPlanFor,
  trialAvailable,
  serializeLimit,
  describePlan,
};
