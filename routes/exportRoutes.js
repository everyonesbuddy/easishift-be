const express = require("express");
const router = express.Router();

const {
  exportPayrollProvider,
  exportSchedules,
  exportTimeEntries,
} = require("../controllers/exportController");
const auth = require("../middleware/authMiddleware");
const { requireFeature } = require("../middleware/planMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(
  auth,
  tenant,
  requirePermission("staff.view"),
  requireFeature("timesheets"),
);

router.get("/payroll/:provider", exportPayrollProvider);
router.get("/time-entries", exportTimeEntries);
router.get("/schedules", exportSchedules);

module.exports = router;