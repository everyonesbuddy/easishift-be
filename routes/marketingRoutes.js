const express = require("express");
const router = express.Router();

const {
  sendTurnoverRoiEmailSummary,
  sendCostLeakEmailSummary,
  sendCallOutCostEmailSummary,
  sendOvertimeCostEmailSummary,
  sendPayrollAccuracyEmailSummary,
} = require("../controllers/marketingController");

// Public endpoint for marketing calculator email capture + summary delivery.
router.post("/turnover-roi/email-summary", sendTurnoverRoiEmailSummary);
router.post("/cost-leak/email-summary", sendCostLeakEmailSummary);
router.post("/call-out-cost/email-summary", sendCallOutCostEmailSummary);
router.post("/overtime-cost/email-summary", sendOvertimeCostEmailSummary);
router.post(
  "/payroll-accuracy/email-summary",
  sendPayrollAccuracyEmailSummary,
);
// Legacy path kept so existing calculator builds keep working.
router.post(
  "/time-clock-accuracy/email-summary",
  sendPayrollAccuracyEmailSummary,
);

module.exports = router;
