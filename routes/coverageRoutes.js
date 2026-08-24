// routes/coverageRoutes.js
const express = require("express");
const router = express.Router();

const {
  createCoverage,
  getCoverage,
  updateCoverage,
  deleteCoverage,
  deleteCoveragesByIds,
  getUnfilledCoverage,
  getUnfilledCoverageForAuto,
} = require("../controllers/coverageController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

// All coverage routes require authentication + tenant context
router.use(auth);
router.use(tenant);

/**
 * Coverage Routes
 * Admin-only:
 *  - create coverage
 *  - update coverage
 *  - delete coverage
 *
 * All staff:
 *  - view coverage
 */

// Everyone in a tenant can view coverage
router.get("/", getCoverage);
router.get("/unfilled", getUnfilledCoverage);
// Admin-only route to get unfilled coverages for auto-generation
router.get(
  "/unfilled-auto",
  requirePermission("coverage.view"),
  getUnfilledCoverageForAuto,
);

// Admin only
router.post("/", requirePermission("coverage.manage"), createCoverage);
router.delete(
  "/bulk",
  requirePermission("coverage.manage"),
  deleteCoveragesByIds,
);
router.put("/:id", requirePermission("coverage.manage"), updateCoverage);
router.delete("/:id", requirePermission("coverage.manage"), deleteCoverage);

module.exports = router;
