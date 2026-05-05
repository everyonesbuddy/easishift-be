const express = require("express");
const router = express.Router();

const {
  getFacilityPreferences,
  upsertFacilityPreferences,
  resetFacilityPreferences,
} = require("../controllers/facilityPreferencesController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const restrictTo = require("../middleware/roleMiddleware");

// All routes require auth + tenant context + admin role
router.use(auth);
router.use(tenant);
router.use(restrictTo("admin"));

// GET    /api/v1/facility-preferences       — fetch current (or default) config
// POST   /api/v1/facility-preferences       — create or update config
// DELETE /api/v1/facility-preferences/reset — wipe back to defaults
router.get("/", getFacilityPreferences);
router.post("/", upsertFacilityPreferences);
router.delete("/reset", resetFacilityPreferences);

module.exports = router;
