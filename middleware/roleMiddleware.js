module.exports = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user)
      return res.status(403).json({ message: "Access denied. No user found." });

    if (!allowedRoles.includes(req.user.role))
      return res
        .status(403)
        .json({ message: "Access denied. Insufficient role." });

    next();
  };
};
