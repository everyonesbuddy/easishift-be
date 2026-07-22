/**
 * Tenant Controller
 * ------------------
 * Handles hospital/clinic data management.
 */

const Tenant = require("../models/tenantModel");
const User = require("../models/userModel");
const Schedule = require("../models/scheduleModel");
const Coverage = require("../models/coverageModel");
const TimeOff = require("../models/timeOffModel");
const Message = require("../models/messageModel");
const Preferences = require("../models/preferencesModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const ShiftSwap = require("../models/shiftSwapModel");
const AutoScheduleDraft = require("../models/autoScheduleDraftModel");

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

/**
 * Delete tenant account and all tenant-scoped data.
 * Route: DELETE /api/v1/tenants/:id
 * Access:
 * - superadmin can delete any tenant
 * - admin can delete only their own tenant
 */
exports.deleteTenantAccount = async (req, res, next) => {
  try {
    const targetTenantId = String(req.params.id || "");
    const requesterTenantId = String(req.tenantId || "");
    const isSuperAdmin = req.user && req.user.role === "superadmin";
    const isAdmin = req.user && req.user.role === "admin";

    if (!targetTenantId) {
      return res.status(400).json({ message: "Tenant id is required" });
    }

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        message: "Access denied. Only admin or superadmin can delete account.",
      });
    }

    if (!isSuperAdmin && requesterTenantId !== targetTenantId) {
      return res.status(403).json({
        message: "Access denied. You can only delete your own tenant account.",
      });
    }

    const tenant = await Tenant.findById(targetTenantId);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const tenantFilter = { tenantId: targetTenantId };

    await Promise.all([
      AutoScheduleDraft.deleteMany(tenantFilter),
      ShiftSwap.deleteMany(tenantFilter),
      Schedule.deleteMany(tenantFilter),
      Coverage.deleteMany(tenantFilter),
      TimeOff.deleteMany(tenantFilter),
      Preferences.deleteMany(tenantFilter),
      Message.deleteMany(tenantFilter),
      FacilityPreferences.deleteMany(tenantFilter),
      User.deleteMany(tenantFilter),
    ]);

    await Tenant.deleteOne({ _id: targetTenantId });

    res.status(200).json({
      message: "Tenant account and all related data deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};
