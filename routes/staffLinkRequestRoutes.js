const express = require("express");
const rateLimit = require("express-rate-limit");
const { requestLink } = require("../controllers/staffLinkRequestController");

const router = express.Router();

// Few tries per device: this sends real texts and emails.
router.post(
  "/request",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message: "Too many requests. Try again in a few minutes." },
  }),
  requestLink,
);

module.exports = router;
