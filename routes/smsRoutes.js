const express = require("express");
const router = express.Router();
const { handleInbound } = require("../controllers/smsController");

// Twilio posts form-encoded bodies.
router.post("/inbound", express.urlencoded({ extended: false }), handleInbound);

module.exports = router;
