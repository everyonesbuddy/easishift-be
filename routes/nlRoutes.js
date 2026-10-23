const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const { parseForm } = require("../controllers/nlParseController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requireFeature } = require("../middleware/planMiddleware");
const { getFormParserConfig } = require("../config/nlFormParsers");

router.use(auth);
router.use(tenant);

// Form types tied to a paid feature (weeklyNeeds -> describeNeeds) answer
// 402 on Free, like any other paid feature.
const planGate = (req, res, next) => {
  const feature = getFormParserConfig(req.body?.formType)?.feature;
  return feature ? requireFeature(feature)(req, res, next) : next();
};

// "Describe your week" is for setting up and adjusting Weekly Needs, not a
// chat: a few tries a minute, a modest number a day, per workspace.
const DESCRIBE_PER_MINUTE = 5;
const DESCRIBE_PER_DAY = 25;
const weeklyNeedsOnly = (req) => req.body?.formType !== "weeklyNeeds";
const byWorkspace = (req) => String(req.tenantId);
const describeLimit = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    skip: weeklyNeedsOnly,
    keyGenerator: byWorkspace,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { code: "rate_limited", message },
  });
const perMinute = describeLimit(
  60 * 1000,
  DESCRIBE_PER_MINUTE,
  "One moment: wait a minute before describing your week again.",
);
const perDay = describeLimit(
  24 * 60 * 60 * 1000,
  DESCRIBE_PER_DAY,
  `You've used Describe your week ${DESCRIBE_PER_DAY} times today. You can still edit the table by hand, or try again tomorrow.`,
);

router.post("/parse", planGate, perMinute, perDay, parseForm);

module.exports = router;
module.exports.DESCRIBE_PER_MINUTE = DESCRIBE_PER_MINUTE;
module.exports.DESCRIBE_PER_DAY = DESCRIBE_PER_DAY;
