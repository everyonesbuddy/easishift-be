/**
 * Plan limit checks.
 *
 * Staff  = active people who are scheduled (no workspace role).
 * Schedulers = owner + admins + schedulers (+ legacy "admin"). Viewers are free.
 */
const User = require("../models/userModel");
const {
  trialAvailable,
  serializeLimit,
  inPostTrialGrace,
} = require("../config/plans");

const SCHEDULER_ROLES = ["owner", "administrator", "admin", "scheduler"];
const ACCOUNT_ROLES = [...SCHEDULER_ROLES, "viewer"];

const countActiveStaff = (tenantId) =>
  User.countDocuments({ tenantId, loginEnabled: false, status: "active" });

const countSchedulers = (tenantId) =>
  User.countDocuments({
    tenantId,
    loginEnabled: true,
    status: { $ne: "archived" },
    $or: [{ roles: { $in: SCHEDULER_ROLES } }, { role: { $in: SCHEDULER_ROLES } }],
  });

const planError = (statusCode, errorCode, message, details) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.errorCode = errorCode;
  err.details = details;
  return err;
};

const getUsage = async (req) => {
  const [staff, schedulers] = await Promise.all([
    countActiveStaff(req.tenantId),
    countSchedulers(req.tenantId),
  ]);
  return {
    staff,
    schedulers,
    overLimit: staff > req.plan.staff || schedulers > req.plan.schedulers,
  };
};

/**
 * Throws 402 PLAN_LIMIT_REACHED when adding `adding` more would go over.
 * kind: "staff" | "schedulers"
 */
const assertLimit = async (req, kind, adding = 1) => {
  const used =
    kind === "staff"
      ? await countActiveStaff(req.tenantId)
      : await countSchedulers(req.tenantId);
  const limit = req.plan[kind];
  if (used + adding > limit) {
    throw planError(
      402,
      "PLAN_LIMIT_REACHED",
      `Your ${req.plan.label} plan allows ${limit} ${limit === 1 ? kind.replace(/s$/, "") : kind}`,
      {
        kind,
        used,
        limit: serializeLimit(limit),
        currentPlan: req.plan.key,
        trialAvailable: trialAvailable(req.tenant),
      },
    );
  }
  return { used, limit };
};

/**
 * After a trial ends over the limits, one week can still be published in the
 * grace window. Returns true if `weekStart` may use it.
 */
const canUseGraceWeek = (tenant, weekStart) =>
  inPostTrialGrace(tenant) &&
  (!tenant.graceWeekStart || tenant.graceWeekStart === weekStart);

/**
 * Throws 402 OVER_PLAN_LIMIT when the workspace already has more staff or
 * schedulers than its plan allows (e.g. after a trial ends or a cancel).
 */
const assertNotOverLimit = async (req) => {
  const usage = await getUsage(req);
  if (!usage.overLimit) return usage;
  throw planError(
    402,
    "OVER_PLAN_LIMIT",
    `You have more staff or schedulers than the ${req.plan.label} plan allows. Upgrade, or archive staff to get back under the limit.`,
    {
      usage,
      limits: {
        staff: serializeLimit(req.plan.staff),
        schedulers: serializeLimit(req.plan.schedulers),
      },
      currentPlan: req.plan.key,
      trialAvailable: trialAvailable(req.tenant),
      graceWeekAvailable:
        inPostTrialGrace(req.tenant) && !req.tenant.graceWeekStart,
    },
  );
};

module.exports = {
  SCHEDULER_ROLES,
  ACCOUNT_ROLES,
  countActiveStaff,
  countSchedulers,
  getUsage,
  assertLimit,
  assertNotOverLimit,
  canUseGraceWeek,
  planError,
};
