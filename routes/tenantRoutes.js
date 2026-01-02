/**
 * Tenant Routes
 * --------------
 * Exposes endpoints to manage hospital/clinic data.
 */

const express = require("express");
const router = express.Router();
const {
  createTenant,
  getTenants,
  getTenantById,
} = require("../controllers/tenantController");

const auth = require("../middleware/authMiddleware");
const restrictTo = require("../middleware/roleMiddleware");

// Only super-admins (you) can access this directly
router
  .route("/")
  .get(auth, restrictTo("superadmin"), getTenants)
  .post(auth, restrictTo("superadmin"), createTenant);

router.route("/:id").get(auth, getTenantById);

module.exports = router;
