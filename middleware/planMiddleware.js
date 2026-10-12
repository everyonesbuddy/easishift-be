const {
  hasFeature,
  requiredPlanFor,
  trialAvailable,
} = require("../config/plans");

/**
 * Blocks a route unless the workspace's effective plan has `feature`.
 * Must run after tenantMiddleware (which sets req.plan / req.tenant).
 */
exports.requireFeature = (feature) => (req, res, next) => {
  if (req.plan && hasFeature(req.plan.key, feature)) return next();
  const requiredPlan = requiredPlanFor(feature);
  return res.status(402).json({
    message: `This needs the ${requiredPlan} plan`,
    errorCode: "PLAN_FEATURE_REQUIRED",
    feature,
    currentPlan: req.plan ? req.plan.key : null,
    requiredPlan,
    // The app shows "Try Pro free for 14 days" when this is true.
    trialAvailable: requiredPlan === "pro" && trialAvailable(req.tenant),
  });
};
