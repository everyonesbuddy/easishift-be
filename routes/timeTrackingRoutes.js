const express = require("express");
const router = express.Router();

const {
  getMyTimeEntries,
  clockIn,
  startBreak,
  endBreak,
  clockOut,
  listTimeEntries,
  adjustTimeEntry,
} = require("../controllers/timeTrackingController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant);

// Staff self-service
router.get("/me", getMyTimeEntries);
router.post("/clock-in", clockIn);
router.post("/breaks/start", startBreak);
router.post("/breaks/end", endBreak);
router.post("/clock-out", clockOut);

// Admin operations
router.get("/", requirePermission("staff.view"), listTimeEntries);
router.patch("/:id/adjust", requirePermission("staff.manage"), adjustTimeEntry);

module.exports = router;
