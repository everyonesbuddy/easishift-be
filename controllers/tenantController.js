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
const TenantAsset = require("../models/tenantAssetModel");
const { hasPermission } = require("../config/authorization");
const {
  normalizeSubdomain,
  validateSubdomain,
  isSubdomainAvailable,
} = require("../utils/tenantDomainUtils");
const {
  BRANDING_SELECT,
  getPublicBranding,
  parseBrandingUpdate,
  invalidateTenantBrandingCache,
} = require("../utils/tenantBranding");
const {
  buildTenantHostname,
  updateNetlifyTenantAliases,
} = require("../utils/netlifyDomainUtils");

const detectImageType = (buffer) => {
  if (!buffer || buffer.length < 12) return null;
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
};

const sendBrandingResponse = async (res, tenantId, message, extra = {}) => {
  const tenant = await Tenant.findById(tenantId).select(BRANDING_SELECT).lean();
  if (!tenant) return res.status(404).json({ message: "Tenant not found" });
  return res.status(200).json({
    ...(message ? { message } : {}),
    branding: getPublicBranding(tenant),
    ...extra,
  });
};

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
 * Get the current tenant's branding and portal URL.
 * Route: GET /api/v1/tenants/me/branding
 */
exports.getMyBranding = async (req, res, next) => {
  try {
    await sendBrandingResponse(res, req.tenantId);
  } catch (err) {
    next(err);
  }
};

/**
 * Update branding fields and/or subdomain.
 * Route: PATCH /api/v1/tenants/me/branding
 */
exports.updateMyBranding = async (req, res, next) => {
  try {
    const { set, errors } = parseBrandingUpdate(req.body || {});
    let previousSubdomain = null;
    let domainProvisioning = null;

    if (req.body?.subdomain !== undefined) {
      const subdomain = normalizeSubdomain(req.body.subdomain);
      const subdomainError = validateSubdomain(subdomain);
      if (subdomainError) {
        return res
          .status(400)
          .json({ message: subdomainError, errorCode: "INVALID_SUBDOMAIN" });
      }
      if (!(await isSubdomainAvailable(subdomain, req.tenantId))) {
        return res.status(409).json({
          message: "That subdomain is already taken",
          errorCode: "SUBDOMAIN_TAKEN",
        });
      }
      const currentTenant = await Tenant.findById(req.tenantId)
        .select("subdomain")
        .lean();
      previousSubdomain = currentTenant?.subdomain || null;

      if (subdomain !== previousSubdomain) {
        try {
          domainProvisioning = await updateNetlifyTenantAliases({
            addSubdomains: [subdomain],
          });
        } catch (err) {
          console.error(
            `Netlify domain alias registration failed for tenant ${req.tenantId}:`,
            err && err.message ? err.message : err,
          );
          return res.status(502).json({
            message:
              "The new workspace hostname could not be registered with the hosting provider; the subdomain was not changed.",
            errorCode: "NETLIFY_DOMAIN_SYNC_FAILED",
          });
        }
      }
      set.subdomain = subdomain;
    }

    if (errors.length) {
      return res.status(400).json({
        message: errors.join("; "),
        errorCode: "INVALID_BRANDING",
      });
    }
    if (!Object.keys(set).length) {
      return res.status(400).json({ message: "No branding fields provided" });
    }

    try {
      await Tenant.updateOne(
        { _id: req.tenantId },
        { $set: set },
        { runValidators: true },
      );
    } catch (err) {
      if (err && err.code === 11000) {
        return res.status(409).json({
          message: "That subdomain is already taken",
          errorCode: "SUBDOMAIN_TAKEN",
        });
      }
      throw err;
    }

    invalidateTenantBrandingCache(req.tenantId);
    if (
      domainProvisioning &&
      previousSubdomain &&
      previousSubdomain !== set.subdomain &&
      domainProvisioning.status !== "not_configured" &&
      domainProvisioning.status !== "local_domain_skipped"
    ) {
      try {
        await updateNetlifyTenantAliases({
          removeSubdomains: [previousSubdomain],
        });
      } catch (err) {
        console.error(
          `Netlify old domain alias cleanup failed for tenant ${req.tenantId}:`,
          err && err.message ? err.message : err,
        );
        domainProvisioning.cleanupStatus = "failed";
      }
    }

    await sendBrandingResponse(res, req.tenantId, "Branding updated", {
      ...(domainProvisioning
        ? {
            tenantDomainProvisioning: {
              status: domainProvisioning.status,
              cleanupStatus: domainProvisioning.cleanupStatus || "complete",
              hostname: buildTenantHostname(
                set.subdomain,
                process.env.TENANT_ROOT_DOMAIN,
              ),
            },
          }
        : {}),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Upload or replace the tenant logo (multipart field "logo").
 * Route: PUT /api/v1/tenants/me/logo
 */
exports.uploadMyLogo = async (req, res, next) => {
  try {
    const buffer = req.file?.buffer;
    const contentType = detectImageType(buffer);
    if (!contentType) {
      return res.status(400).json({
        message: "Logo must be a PNG, JPEG, or WebP image",
        errorCode: "INVALID_LOGO",
      });
    }

    await TenantAsset.findOneAndUpdate(
      { tenantId: req.tenantId, kind: "logo" },
      { contentType, size: buffer.length, data: buffer },
      { upsert: true, setDefaultsOnInsert: true },
    );
    await Tenant.updateOne(
      { _id: req.tenantId },
      { $set: { "branding.logoUpdatedAt": new Date() } },
    );

    invalidateTenantBrandingCache(req.tenantId);
    await sendBrandingResponse(res, req.tenantId, "Logo updated");
  } catch (err) {
    next(err);
  }
};

/**
 * Remove the tenant logo.
 * Route: DELETE /api/v1/tenants/me/logo
 */
exports.deleteMyLogo = async (req, res, next) => {
  try {
    await TenantAsset.deleteOne({ tenantId: req.tenantId, kind: "logo" });
    await Tenant.updateOne(
      { _id: req.tenantId },
      { $set: { "branding.logoUpdatedAt": null } },
    );

    invalidateTenantBrandingCache(req.tenantId);
    await sendBrandingResponse(res, req.tenantId, "Logo removed");
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
    const canDeleteTenant =
      req.user && hasPermission(req.user, "tenant.delete");

    if (!targetTenantId) {
      return res.status(400).json({ message: "Tenant id is required" });
    }

    if (!canDeleteTenant) {
      return res.status(403).json({
        message: "Access denied. Only admin or superadmin can delete account.",
      });
    }

    if (requesterTenantId !== targetTenantId) {
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
      TenantAsset.deleteMany(tenantFilter),
      User.deleteMany(tenantFilter),
    ]);

    await Tenant.deleteOne({ _id: targetTenantId });
    invalidateTenantBrandingCache(targetTenantId);

    res.status(200).json({
      message: "Tenant account and all related data deleted successfully",
    });
  } catch (err) {
    next(err);
  }
};
