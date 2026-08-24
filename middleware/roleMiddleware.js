const { hasPermission, hasSystemRole } = require("../config/authorization");

const requirePermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user)
      return res.status(403).json({ message: "Access denied. No user found." });

    if (!permissions.some((permission) => hasPermission(req.user, permission)))
      return res
        .status(403)
        .json({ message: "Access denied. Insufficient permission." });

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
