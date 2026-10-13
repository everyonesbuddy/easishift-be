const express = require("express");
const router = express.Router();
const { startTrial } = require("../controllers/stripeController");
const { fitToPlan } = require("../controllers/planFitController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

// One-time, no-card 14-day Starter trial (owner only)
router.post(
  "/start-trial",
  auth,
  tenant,
  requirePermission("billing.manage"),
  startTrial,
);

// After a trial ends over the limits: choose who stays (owner only)
router.post(
  "/fit-to-plan",
  auth,
  tenant,
  requirePermission("billing.manage"),
  fitToPlan,
);

module.exports = router;
