const express = require("express");
const router = express.Router();
const bodyParser = require("body-parser");
const {
  createCheckoutSession,
  handleWebhook,
  cancelSubscription,
} = require("../controllers/stripeController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const restrictTo = require("../middleware/roleMiddleware");

// Stripe needs the raw body for webhook signature verification. Keep webhook public.
router.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  handleWebhook
);

// Protected routes: require authentication + tenant context
// Apply middleware per-route (keeps webhook public)
router.post(
  "/create-checkout-session",
  auth,
  tenant,
  restrictTo("admin"),
  createCheckoutSession
);

// Cancel subscription (admin)
router.post(
  "/cancel-subscription",
  auth,
  tenant,
  restrictTo("admin"),
  cancelSubscription
);

module.exports = router;
