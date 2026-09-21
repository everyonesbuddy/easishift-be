const express = require("express");
const router = express.Router();

const {
  exportPayrollProvider,
  exportSchedules,
  exportTimeEntries,
} = require("../controllers/exportController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant, requirePermission("staff.view"));

router.get("/payroll/:provider", exportPayrollProvider);
router.get("/time-entries", exportTimeEntries);
router.get("/schedules", exportSchedules);

module.exports = router;