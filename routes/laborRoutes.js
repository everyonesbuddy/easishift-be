const express = require("express");
const router = express.Router();
const labor = require("../controllers/laborController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");
const { requireFeature } = require("../middleware/planMiddleware");

router.use(auth, tenant, requireFeature("labor"));

router.get("/report", requirePermission("labor.view"), labor.getReport);
router.get("/trends", requirePermission("labor.view"), labor.getTrends);
router.get(
  "/overtime/:staffId/options",
  requirePermission("labor.view"),
  requirePermission("schedule.manage"),
  labor.getOvertimeOptions,
);
router.post("/report/send", requirePermission("labor.manage"), labor.sendReportNow);
router.get("/settings", requirePermission("labor.view"), labor.getSettings);
router.put("/settings", requirePermission("labor.manage"), labor.updateSettings);
// Residents per day: schedulers too (often the DON), so it can be done from the phone.
router.put("/census", requirePermission("labor.census"), labor.updateCensus);

module.exports = router;
