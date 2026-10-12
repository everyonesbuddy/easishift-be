/**
 * Plans — the single source of truth for limits and features.
 *
 * Everyone starts on Free. The owner can start a one-time, no-card 14-day
 * Pro trial. A paid plan comes from Stripe (tenant.plan + subscriptionStatus).
 */

const PRO_FEATURES = [
  "sms",
  "swaps",
  "pickup",
  "calloutText",
  "import",
  "reminders",
];
const FACILITY_FEATURES = [
  ...PRO_FEATURES,
  "autoFill",
  "timeClock",
  "timesheets",
  "messaging",
  "dashboard",
];

const PLANS = Object.freeze({
  free: { label: "Free", schedulers: 1, staff: 15, features: [] },
  pro: { label: "Pro", schedulers: 3, staff: 75, features: PRO_FEATURES },
  facility: {
    label: "Facility",
    schedulers: 10,
    staff: 200,
    features: FACILITY_FEATURES,
  },
  organization: {
    label: "Organization",
    schedulers: Infinity,
    staff: Infinity,
    features: [...FACILITY_FEATURES, "branding"],
  },
});

// Plans that can be bought through Stripe checkout.
const PAID_PLAN_KEYS = ["pro", "facility"];
const PLAN_ORDER = ["free", "pro", "facility", "organization"];
const PAID_STATUSES = ["active", "trialing", "past_due"];
const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const isPaid = (tenant) =>
  Boolean(tenant) &&
  tenant.plan &&
  tenant.plan !== "free" &&
  PAID_STATUSES.includes(tenant.subscriptionStatus);

const isTrialActive = (tenant, now = new Date()) =>
  Boolean(tenant?.trialEndsAt) && new Date(tenant.trialEndsAt) > now;

/** The plan the workspace actually gets right now. */
function getEffectivePlanKey(tenant, now = new Date()) {
  if (isPaid(tenant)) return tenant.plan;
  if (isTrialActive(tenant, now)) return "pro";
  return "free";
}

const getPlan = (key) => ({ key, ...(PLANS[key] || PLANS.free) });

const hasFeature = (planKey, feature) =>
  Boolean(PLANS[planKey]?.features.includes(feature));

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
    features: plan.features,
  };
};

module.exports = {
  PLANS,
  PAID_PLAN_KEYS,
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
