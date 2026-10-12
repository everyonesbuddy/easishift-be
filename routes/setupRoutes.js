const express = require("express");
const router = express.Router();
const {
  listFacilityTypes,
  applyFacilityType,
  completeSetup,
} = require("../controllers/setupController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant);

router.get("/facility-types", listFacilityTypes);
router.post(
  "/facility-type",
  requirePermission("facility_preferences.manage"),
  applyFacilityType,
);
router.post(
  "/complete",
  requirePermission("facility_preferences.manage"),
  completeSetup,
);

module.exports = router;
