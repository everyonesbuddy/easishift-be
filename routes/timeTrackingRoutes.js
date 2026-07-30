const express = require("express");
const router = express.Router();

const {
  getMyTimeEntries,
  clockIn,
  startBreak,
  endBreak,
  clockOut,
  listTimeEntries,
  generateQrClockToken,
  getCurrentQrClockToken,
  adjustTimeEntry,
} = require("../controllers/timeTrackingController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const restrictTo = require("../middleware/roleMiddleware");

router.use(auth, tenant);

// Staff self-service
router.get("/me", getMyTimeEntries);
router.post("/clock-in", clockIn);
router.post("/breaks/start", startBreak);
router.post("/breaks/end", endBreak);
router.post("/clock-out", clockOut);

// Admin operations
router.get("/qr-token/current", getCurrentQrClockToken);
router.post("/qr-token", restrictTo("admin"), generateQrClockToken);
router.get("/", restrictTo("admin"), listTimeEntries);
router.patch("/:id/adjust", restrictTo("admin"), adjustTimeEntry);

module.exports = router;
