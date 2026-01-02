/**
 * Tenant Controller
 * ------------------
 * Handles hospital/clinic data management.
 */

const Tenant = require("../models/tenantModel");

/**
 * Create a new tenant (used internally or for onboarding)
 * Route: POST /api/v1/tenants
 */
exports.createTenant = async (req, res, next) => {
  try {
    const tenant = await Tenant.create(req.body);
    res.status(201).json({ tenant });
  } catch (err) {
    next(err);
  }
};

/**
 * Get all tenants (super admin use)
 * Route: GET /api/v1/tenants
 */
exports.getTenants = async (req, res, next) => {
  try {
    const tenants = await Tenant.find();
    res.status(200).json({ tenants });
  } catch (err) {
    next(err);
  }
};

/**
 * Get single tenant (for admin dashboard)
 * Route: GET /api/v1/tenants/:id
 */
exports.getTenantById = async (req, res, next) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    res.status(200).json({ tenant });
  } catch (err) {
    next(err);
  }
};
