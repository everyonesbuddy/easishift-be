// routes/schedulesRoutes.js
const express = require("express");
const router = express.Router();
const {
  createSchedule,
  getSchedules,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
  deleteSchedulesByIds,
  autoGenerateSchedule,
  getAutoScheduleDrafts,
  getAutoScheduleDraftById,
  updateAutoScheduleDraftAssignment,
  publishAutoScheduleDraft,
  discardAutoScheduleDraft,
  requestShiftSwap,
  getShiftSwapRequests,
  respondToShiftSwapRequest,
} = require("../controllers/scheduleController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const restrictTo = require("../middleware/roleMiddleware"); // optional

router.use(auth, tenant);

// GET /api/v1/schedules?staffId=&from=&to=
router.get("/", getSchedules);

// POST /api/v1/schedules  (admin only ideally, maybe)
router.post("/", createSchedule);

// AUTO GENERATE (admin only)
router.post("/auto-generate", restrictTo("admin"), autoGenerateSchedule);

// AUTO-SCHEDULE DRAFTS (admin only)
router.get("/draft-schedules", restrictTo("admin"), getAutoScheduleDrafts);
router.get(
  "/draft-schedules/:draftId",
  restrictTo("admin"),
  getAutoScheduleDraftById,
);
router.patch(
  "/draft-schedules/:draftId/assignments/:assignmentId",
  restrictTo("admin"),
  updateAutoScheduleDraftAssignment,
);
router.post(
  "/draft-schedules/:draftId/publish",
  restrictTo("admin"),
  publishAutoScheduleDraft,
);
router.post(
  "/draft-schedules/:draftId/discard",
  restrictTo("admin"),
  discardAutoScheduleDraft,
);

// SHIFT SWAP REQUESTS
router.get("/swap-requests", getShiftSwapRequests);
router.post("/swap-requests/:swapRequestId/respond", respondToShiftSwapRequest);
router.post("/:id/swap-requests", requestShiftSwap);

router.get("/:id", getScheduleById);

// PUT /api/v1/schedules/:id  (admin or schedule owner -> allow update)
router.put("/:id", updateSchedule);

// DELETE /api/v1/schedules/bulk
router.delete("/bulk", restrictTo("admin"), deleteSchedulesByIds);

// DELETE /api/v1/schedules/:id
router.delete("/:id", restrictTo("admin"), deleteSchedule);

module.exports = router;
