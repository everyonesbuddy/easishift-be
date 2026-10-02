/**
 * Tenant Routes
 * --------------
 * Exposes endpoints to manage hospital/clinic data.
 */

const express = require("express");
const multer = require("multer");
const router = express.Router();
const {
  createTenant,
  getTenants,
  getTenantById,
  deleteTenantAccount,
  getMyBranding,
  updateMyBranding,
  uploadMyLogo,
  deleteMyLogo,
} = require("../controllers/tenantController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const restrictTo = require("../middleware/roleMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

const LOGO_MAX_BYTES = 512 * 1024;
const LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

const logoUpload = (req, res, next) => {
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LOGO_MAX_BYTES, files: 1 },
    fileFilter(_req, file, cb) {
      cb(null, LOGO_MIME_TYPES.includes(file.mimetype));
    },
  }).single("logo")(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `Logo must be ${LOGO_MAX_BYTES / 1024} KB or smaller`
        : "Invalid logo upload";
    return res.status(400).json({ message, errorCode: "INVALID_LOGO" });
  });
};

// Only super-admins (you) can access this directly
router
  .route("/")
  .get(auth, restrictTo("superadmin"), getTenants)
  .post(auth, restrictTo("superadmin"), createTenant);

router
  .route("/me/branding")
  .get(auth, tenant, getMyBranding)
  .patch(auth, tenant, requirePermission("tenant.settings"), updateMyBranding);

router
  .route("/me/logo")
  .put(
    auth,
    tenant,
    requirePermission("tenant.settings"),
    logoUpload,
    uploadMyLogo,
  )
  .delete(auth, tenant, requirePermission("tenant.settings"), deleteMyLogo);

router
  .route("/:id")
  .get(auth, getTenantById)
  .delete(auth, requirePermission("tenant.delete"), deleteTenantAccount);

module.exports = router;
