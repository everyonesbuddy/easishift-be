const express = require("express");
const router = express.Router();

const {
  sendTurnoverRoiEmailSummary,
  sendCostLeakEmailSummary,
} = require("../controllers/marketingController");

// Public endpoint for marketing calculator email capture + summary delivery.
router.post("/turnover-roi/email-summary", sendTurnoverRoiEmailSummary);
router.post("/cost-leak/email-summary", sendCostLeakEmailSummary);

module.exports = router;
