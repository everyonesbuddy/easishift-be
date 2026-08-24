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
  fillAutoScheduleDraftAssignmentWithAI,
  publishAutoScheduleDraft,
  discardAutoScheduleDraft,
  requestShiftSwap,
  getShiftSwapRequests,
  respondToShiftSwapRequest,
  getOpenCoverageForMe,
  pickUpSchedule,
} = require("../controllers/scheduleController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant);

// GET /api/v1/schedules?staffId=&from=&to=
router.get("/", getSchedules);

// POST /api/v1/schedules  (admin only ideally, maybe)
router.post("/", requirePermission("schedule.manage"), createSchedule);
router.get(
  "/open-for-me",
  requirePermission("schedule.pick_up"),
  getOpenCoverageForMe,
);
router.post("/pick-up", requirePermission("schedule.pick_up"), pickUpSchedule);

// AUTO GENERATE Draft (admin only)
router.post(
  "/auto-generate",
  requirePermission("schedule.manage"),
  autoGenerateSchedule,
);

// AUTO-SCHEDULE DRAFTS (admin only)
router.get(
  "/draft-schedules",
  requirePermission("schedule.view"),
  getAutoScheduleDrafts,
);
router.get(
  "/draft-schedules/:draftId",
  requirePermission("schedule.view"),
  getAutoScheduleDraftById,
);
router.patch(
  "/draft-schedules/:draftId/assignments/:assignmentId",
  requirePermission("schedule.manage"),
  updateAutoScheduleDraftAssignment,
);
router.post(
  "/draft-schedules/:draftId/assignments/:assignmentId/fill-ai",
  requirePermission("schedule.manage"),
  fillAutoScheduleDraftAssignmentWithAI,
);
router.post(
  "/draft-schedules/:draftId/publish",
  requirePermission("schedule.manage"),
  publishAutoScheduleDraft,
);
router.post(
  "/draft-schedules/:draftId/discard",
  requirePermission("schedule.manage"),
  discardAutoScheduleDraft,
);

// SHIFT SWAP REQUESTS
router.get("/swap-requests", getShiftSwapRequests);
router.post("/swap-requests/:swapRequestId/respond", respondToShiftSwapRequest);
router.post("/:id/swap-requests", requestShiftSwap);

router.get("/:id", getScheduleById);

// PUT /api/v1/schedules/:id  (admin or schedule owner -> allow update)
router.put("/:id", requirePermission("schedule.manage"), updateSchedule);

// DELETE /api/v1/schedules/bulk
router.delete(
  "/bulk",
  requirePermission("schedule.manage"),
  deleteSchedulesByIds,
);

// DELETE /api/v1/schedules/:id
router.delete("/:id", requirePermission("schedule.manage"), deleteSchedule);

module.exports = router;
