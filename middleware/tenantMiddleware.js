const Tenant = require("../models/tenantModel");

module.exports = async (req, res, next) => {
  try {
    if (!req.tenantId)
      return res.status(400).json({ message: "Missing tenant context" });

    const tenant = await Tenant.findById(req.tenantId);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    req.tenant = tenant;
    next();
  } catch (err) {
    next(err);
  }
};
