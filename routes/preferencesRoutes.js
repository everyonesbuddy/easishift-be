const express = require("express");
const router = express.Router();

const {
  getPreferencesForStaff,
  upsertPreferencesForStaff,
} = require("../controllers/preferencesController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

// All preference routes require user auth + tenant context
router.use(auth);
router.use(tenant);

// Staff manage their own preferences through their link (/api/v1/s/:token/preferences).

/**
 * STAFF ROUTES
 * Staff can view + update their own preferences
 */

// Get my preferences

// Create or update my preferences

/**
 * ADMIN ROUTES
 * Admin can view preferences of any staff member
 */

router.get(
  "/:staffId",
  requirePermission("staff.view"),
  getPreferencesForStaff,
);
router.post(
  "/:staffId",
  requirePermission("staff.manage"),
  upsertPreferencesForStaff,
);

module.exports = router;
