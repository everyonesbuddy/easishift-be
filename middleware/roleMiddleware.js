const { hasPermission, hasSystemRole } = require("../config/authorization");

const isViewPermission = (permission) => /\.view(_own)?$/.test(permission);

const requirePermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user)
      return res.status(403).json({ message: "Access denied. No user found." });

    const allowed = permissions.filter((permission) =>
      hasPermission(req.user, permission),
    );
    if (!allowed.length)
      return res
        .status(403)
        .json({ message: "Access denied. Insufficient permission." });

    // Over the plan's scheduler limit: non-owner schedulers can look only.
    if (req.readOnlyReason && !allowed.some(isViewPermission)) {
      return res.status(402).json({
        message:
          "Your workspace has more schedulers than its plan allows, so only the owner can make changes for now. Ask the owner to upgrade or choose who stays a scheduler.",
        errorCode: "SCHEDULER_READ_ONLY",
        reason: req.readOnlyReason,
        currentPlan: req.plan?.key || null,
        trialAvailable: false,
      });
    }

    next();
  };
};

const restrictTo = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user)
      return res.status(403).json({ message: "Access denied. No user found." });

    if (!allowedRoles.some((role) => hasSystemRole(req.user, role)))
      return res
        .status(403)
        .json({ message: "Access denied. Insufficient role." });

    next();
  };
};

module.exports = restrictTo;
module.exports.requirePermission = requirePermission;
