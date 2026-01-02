// routes/summaryRoutes.js
const express = require("express");
const router = express.Router();

const summaryCtrl = require("../controllers/summaryController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const restrictTo = require("../middleware/roleMiddleware");

// Must be logged in + tenant-scoped
router.use(auth, tenant);

router.get("/admin/:adminId", restrictTo("admin"), summaryCtrl.getAdminSummary);

router.get("/staff/:staffId", summaryCtrl.getStaffSummary);

module.exports = router;
