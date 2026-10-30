const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const {
  sendTurnoverRoiEmailSummary,
  sendCostLeakEmailSummary,
  sendCallOutCostEmailSummary,
  sendOvertimeCostEmailSummary,
  sendPayrollAccuracyEmailSummary,
} = require("../controllers/marketingController");
const { captureCalculatorLead, captureLead, isEmail } = require("../utils/hq/leads");

// Public, so limited per visitor (each one sends an email).
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many requests from here. Try again in an hour." },
});
router.use(limiter);

// Public endpoint for marketing calculator email capture + summary delivery.
// Each also records the lead (HQ + Klaviyo).
router.post("/turnover-roi/email-summary", captureCalculatorLead("turnover-roi"), sendTurnoverRoiEmailSummary);
router.post("/cost-leak/email-summary", captureCalculatorLead("cost-leak"), sendCostLeakEmailSummary);
router.post("/call-out-cost/email-summary", captureCalculatorLead("call-out-cost"), sendCallOutCostEmailSummary);
router.post("/overtime-cost/email-summary", captureCalculatorLead("overtime-cost"), sendOvertimeCostEmailSummary);
router.post(
  "/payroll-accuracy/email-summary",
  captureCalculatorLead("payroll-accuracy"),
  sendPayrollAccuracyEmailSummary,
);
// Legacy path kept so existing calculator builds keep working.
router.post(
  "/time-clock-accuracy/email-summary",
  captureCalculatorLead("payroll-accuracy"),
  sendPayrollAccuracyEmailSummary,
);

/**
 * Email capture without a summary email (the newer calculators, the blog,
 * newsletter sign-up). { email, source, company?, summary?, newsletter?, utm?, website? }
 */
router.post("/lead", async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.status(202).json({ ok: true }); // honeypot
    if (!isEmail(b.email)) return res.status(400).json({ message: "Enter a valid email address" });
    await captureLead(b);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
