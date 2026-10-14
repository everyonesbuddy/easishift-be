const Tenant = require("../models/tenantModel");
const { getEffectivePlanKey, getPlan } = require("../config/plans");
const { getUserRoles } = require("../config/authorization");
const { countSchedulers } = require("../utils/planLimits");

/**
 * Loads the workspace and its effective plan onto the request.
 *
 * If the workspace has more schedulers than its plan allows (e.g. a trial
 * ended), schedulers other than the owner become read-only until the owner
 * upgrades or chooses who stays a scheduler: req.readOnlyReason is set and
 * requirePermission() only lets ".view" permissions through.
 */
module.exports = async (req, res, next) => {
  try {
    if (!req.tenantId)
      return res.status(400).json({ message: "Missing tenant context" });

    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    req.tenant = tenant;
    req.plan = getPlan(getEffectivePlanKey(tenant));

    const roles = req.user?.loginEnabled ? getUserRoles(req.user) : [];
    // Owners and admins can always act (they're the ones who fix the plan).
    const isNonOwnerScheduler =
      !roles.includes("owner") &&
      !roles.includes("administrator") &&
      (roles.includes("scheduler") || roles.includes("admin"));
    if (isNonOwnerScheduler && Number.isFinite(req.plan.schedulers)) {
      const schedulers = await countSchedulers(req.tenantId);
      if (schedulers > req.plan.schedulers) {
        req.readOnlyReason = "over_scheduler_limit";
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};
