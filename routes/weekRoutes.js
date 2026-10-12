const express = require("express");
const router = express.Router();
const {
  getCurrentWeek,
  getWeek,
  getCandidates,
} = require("../controllers/weekController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant);

router.get("/current", requirePermission("schedule.view"), getCurrentWeek);
router.get("/:weekStart", requirePermission("schedule.view"), getWeek);
router.get(
  "/:weekStart/candidates",
  requirePermission("schedule.manage"),
  getCandidates,
);

module.exports = router;
