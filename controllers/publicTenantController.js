/**
 * Public Tenant Controller
 * ------------------------
 * Unauthenticated, read-only tenant assets (logo used in branded emails).
 */

const mongoose = require("mongoose");
const TenantAsset = require("../models/tenantAssetModel");

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
