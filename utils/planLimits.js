/**
 * Plan limit checks.
 *
 * Staff  = active people who are scheduled (no workspace role).
 * Schedulers = owner + schedulers (+ legacy admins). Viewers are free.
 */
const User = require("../models/userModel");
const { trialAvailable, serializeLimit } = require("../config/plans");

const SCHEDULER_ROLES = ["owner", "admin", "scheduler"];
const ACCOUNT_ROLES = [...SCHEDULER_ROLES, "viewer"];

const countActiveStaff = (tenantId) =>
  User.countDocuments({
    tenantId,
    status: { $ne: "archived" },
    roles: { $nin: ACCOUNT_ROLES },
    role: { $nin: ACCOUNT_ROLES },
  });

const countSchedulers = (tenantId) =>
  User.countDocuments({
    tenantId,
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
      `Your ${req.plan.label} plan allows ${limit} ${kind}`,
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
  planError,
};
