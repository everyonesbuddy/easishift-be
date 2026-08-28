const express = require("express");
const router = express.Router();
const bodyParser = require("body-parser");
const {
  createCheckoutSession,
  handleWebhook,
  cancelSubscription,
  getPlans,
  changePlan,
} = require("../controllers/stripeController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

// Stripe needs the raw body for webhook signature verification. Keep webhook public.
router.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  handleWebhook,
);

// Protected routes: require authentication + tenant context
// Apply middleware per-route (keeps webhook public)
router.get(
  "/plans",
  auth,
  tenant,
  requirePermission("billing.manage"),
  getPlans,
);

router.post(
  "/create-checkout-session",
  auth,
  tenant,
  requirePermission("billing.manage"),
  createCheckoutSession,
);

// Switch plans on an existing subscription (admin)
router.post(
  "/change-plan",
  auth,
  tenant,
  requirePermission("billing.manage"),
  changePlan,
);

// Cancel subscription (admin)
router.post(
  "/cancel-subscription",
  auth,
  tenant,
  requirePermission("billing.manage"),
  cancelSubscription,
);

module.exports = router;
