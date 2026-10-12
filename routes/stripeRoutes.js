const express = require("express");
const router = express.Router();
const bodyParser = require("body-parser");
const {
  createCheckoutSession,
  handleWebhook,
  cancelSubscription,
  getPlans,
  changePlan,
  createPortalSession,
} = require("../controllers/stripeController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

// Stripe webhook (signature verified in the controller)
router.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  handleWebhook,
);

const billing = [auth, tenant, requirePermission("billing.manage")];

router.get("/plans", auth, tenant, requirePermission("billing.view"), getPlans);
router.post("/create-checkout-session", ...billing, createCheckoutSession);
router.post("/change-plan", ...billing, changePlan);
router.post("/portal", ...billing, createPortalSession);
router.post("/cancel-subscription", ...billing, cancelSubscription);

module.exports = router;
