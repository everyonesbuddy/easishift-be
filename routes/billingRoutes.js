const express = require("express");
const router = express.Router();
const { startTrial } = require("../controllers/stripeController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

// One-time, no-card 14-day Pro trial (owner only)
router.post(
  "/start-trial",
  auth,
  tenant,
  requirePermission("billing.manage"),
  startTrial,
);

module.exports = router;
