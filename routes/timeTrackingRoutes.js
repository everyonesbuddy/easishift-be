const express = require("express");
const router = express.Router();

const {
  listTimeEntries,
  adjustTimeEntry,
} = require("../controllers/timeTrackingController");

const auth = require("../middleware/authMiddleware");
const { requireFeature } = require("../middleware/planMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant, requireFeature("timeClock"));

// Staff clock in/out through their personal link (/api/v1/s/:token/clock-in).

// Staff self-service

// Admin operations
router.get(
  "/",
  requirePermission("staff.view"),
  requireFeature("timesheets"),
  listTimeEntries,
);
router.patch(
  "/:id/adjust",
  requirePermission("staff.manage"),
  requireFeature("timesheets"),
  adjustTimeEntry,
);

module.exports = router;
