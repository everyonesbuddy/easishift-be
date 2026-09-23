const express = require("express");
const router = express.Router();

const {
  sendTurnoverRoiEmailSummary,
  sendCostLeakEmailSummary,
  sendCallOutCostEmailSummary,
  sendOvertimeCostEmailSummary,
} = require("../controllers/marketingController");

// Public endpoint for marketing calculator email capture + summary delivery.
router.post("/turnover-roi/email-summary", sendTurnoverRoiEmailSummary);
router.post("/cost-leak/email-summary", sendCostLeakEmailSummary);
router.post("/call-out-cost/email-summary", sendCallOutCostEmailSummary);
router.post("/overtime-cost/email-summary", sendOvertimeCostEmailSummary);

module.exports = router;
