const jwt = require("jsonwebtoken");
const User = require("../models/userModel");

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

    if (!req.user)
      return res.status(401).json({ message: "Invalid authentication" });

    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(401).json({ message: "Invalid or expired token" });
  }
};
