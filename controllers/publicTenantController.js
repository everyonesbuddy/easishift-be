/**
 * Public Tenant Controller
 * ------------------------
 * Unauthenticated, read-only tenant data for branded login pages.
 */

const mongoose = require("mongoose");
const Tenant = require("../models/tenantModel");
const TenantAsset = require("../models/tenantAssetModel");
const {
  normalizeSubdomain,
  validateSubdomain,
  isSubdomainAvailable,
  extractSubdomainFromHost,
} = require("../utils/tenantDomainUtils");
const {
  BRANDING_SELECT,
  getPublicBranding,
} = require("../utils/tenantBranding");

/**
 * Route: GET /api/v1/public/tenant-branding?host=abc.wisershifts.com
 *        GET /api/v1/public/tenant-branding?subdomain=abc
 */
exports.getTenantBranding = async (req, res, next) => {
  try {
    const subdomain = req.query.subdomain
      ? normalizeSubdomain(req.query.subdomain)
      : extractSubdomainFromHost(req.query.host);

    if (!subdomain || validateSubdomain(subdomain)) {
      return res
        .status(404)
        .json({ message: "Tenant not found", errorCode: "TENANT_NOT_FOUND" });
    }

    const tenant = await Tenant.findOne({ subdomain })
      .select(BRANDING_SELECT)
      .lean();
    if (!tenant) {
      return res
        .status(404)
        .json({ message: "Tenant not found", errorCode: "TENANT_NOT_FOUND" });
    }

    res.set("Cache-Control", "public, max-age=60");
    res.status(200).json({ branding: getPublicBranding(tenant) });
  } catch (err) {
    next(err);
  }
};

/**
 * Route: GET /api/v1/public/tenants/:tenantId/logo
 */
exports.getTenantLogo = async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(404).json({ message: "Logo not found" });
    }

    const asset = await TenantAsset.findOne({ tenantId, kind: "logo" })
      .select("contentType data updatedAt")
      .lean();
    if (!asset) return res.status(404).json({ message: "Logo not found" });

    res.set({
      "Content-Type": asset.contentType,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    res.status(200).send(Buffer.from(asset.data.buffer || asset.data));
  } catch (err) {
    next(err);
  }
};

/**
 * Route: GET /api/v1/public/subdomain-availability?subdomain=abc
 */
exports.checkSubdomainAvailability = async (req, res, next) => {
  try {
    const subdomain = normalizeSubdomain(req.query.subdomain);
    const error = validateSubdomain(subdomain);
    if (error) {
      return res
        .status(200)
        .json({ subdomain, available: false, reason: error });
    }

    const available = await isSubdomainAvailable(subdomain);
    res.status(200).json({
      subdomain,
      available,
      reason: available ? null : "subdomain is already taken",
    });
  } catch (err) {
    next(err);
  }
};
