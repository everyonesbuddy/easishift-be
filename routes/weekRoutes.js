const express = require("express");
const router = express.Router();
const {
  getCurrentWeek,
  getWeek,
  getCandidates,
  publishWeek,
  getWeeksInRange,
  addSlot,
  autoFillWeek,
} = require("../controllers/weekController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");
const { requireFeature } = require("../middleware/planMiddleware");

router.use(auth, tenant);

router.get("/", requirePermission("schedule.view"), getWeeksInRange);
router.get("/current", requirePermission("schedule.view"), getCurrentWeek);
router.get("/:weekStart", requirePermission("schedule.view"), getWeek);
router.get(
  "/:weekStart/candidates",
  requirePermission("schedule.manage"),
  getCandidates,
);

router.post(
  "/:weekStart/publish",
  requirePermission("schedule.manage"),
  publishWeek,
);

router.post(
  "/:weekStart/slots",
  requirePermission("coverage.manage"),
  addSlot,
);

// Auto-fill open slots with the best available people (as drafts in a
// draft week; sent right away in a published week).
router.post(
  "/:weekStart/auto-fill",
  requirePermission("schedule.manage"),
  requireFeature("autoFill"),
  autoFillWeek,
);

module.exports = router;
