// routes/coverageRoutes.js
const express = require("express");
const router = express.Router();

const {
  createCoverage,
  getCoverage,
  updateCoverage,
  deleteCoverage,
  getUnfilledCoverage,
  getUnfilledCoverageForAuto,
} = require("../controllers/coverageController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const restrictTo = require("../middleware/roleMiddleware");

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
router.get("/unfilled-auto", restrictTo("admin"), getUnfilledCoverageForAuto);

// Admin only
router.post("/", restrictTo("admin"), createCoverage);
router.put("/:id", restrictTo("admin"), updateCoverage);
router.delete("/:id", restrictTo("admin"), deleteCoverage);

module.exports = router;
