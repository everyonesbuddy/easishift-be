const express = require("express");
const router = express.Router();

const {
  sendTurnoverRoiEmailSummary,
} = require("../controllers/marketingController");

// Public endpoint for marketing calculator email capture + summary delivery.
router.post("/turnover-roi/email-summary", sendTurnoverRoiEmailSummary);

module.exports = router;
