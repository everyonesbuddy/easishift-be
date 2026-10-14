const jwt = require("jsonwebtoken");
const User = require("../models/userModel");
const {
  getEffectivePermissions,
  getUserRoles,
} = require("../config/authorization");

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.cookies.jwt;

    if (!authHeader)
      return res.status(401).json({ message: "Not authenticated" });

    const token = authHeader.startsWith("Bearer ")
      ? authHeader.split(" ")[1]
      : authHeader;

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach user + tenant to request
    req.user = await User.findById(decoded.id);
    req.tenantId = decoded.tenantId;

    // Only active workspace accounts hold sessions (staff use their link).
    if (!req.user || !req.user.loginEnabled || req.user.status === "archived")
      return res.status(401).json({ message: "Invalid authentication" });

    req.user.roles = getUserRoles(req.user);
    req.user.permissions = getEffectivePermissions(req.user);

    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};
