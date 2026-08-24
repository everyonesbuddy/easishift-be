// routes/timeOffRoutes.js
const express = require("express");
const router = express.Router();
const {
  requestTimeOff,
  getTimeOff,
  reviewTimeOff,
} = require("../controllers/timeOffController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant);

router.post("/", requestTimeOff);
router.get("/", getTimeOff);
router.patch("/:id/review", requirePermission("timeoff.review"), reviewTimeOff);

module.exports = router;
