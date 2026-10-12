// routes/scheduleRoutes.js
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
} = require("../controllers/scheduleController");

const { markCallOut } = require("../controllers/calloutController");
const { requireFeature } = require("../middleware/planMiddleware");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant);

// Staff use their personal link (/api/v1/s/:token) to see open shifts, pick
// up, swap and call out; these routes are for schedulers.

// GET /api/v1/schedules?staffId=&from=&to=
router.get("/", requirePermission("schedule.view"), getSchedules);

// POST /api/v1/schedules  (draft until the week is published)
router.post("/", requirePermission("schedule.manage"), createSchedule);

// AUTO GENERATE Draft (admin only)
router.post(
  "/auto-generate",
  requirePermission("schedule.manage"),
  requireFeature("autoFill"),
  autoGenerateSchedule,
);

// AUTO-SCHEDULE DRAFTS (admin only)
router.get(
  "/draft-schedules",
  requirePermission("schedule.view"),
  requireFeature("autoFill"),
  getAutoScheduleDrafts,
);
router.get(
  "/draft-schedules/:draftId",
  requirePermission("schedule.view"),
  requireFeature("autoFill"),
  getAutoScheduleDraftById,
);
router.patch(
  "/draft-schedules/:draftId/assignments/:assignmentId",
  requirePermission("schedule.manage"),
  requireFeature("autoFill"),
  updateAutoScheduleDraftAssignment,
);
router.post(
  "/draft-schedules/:draftId/assignments/:assignmentId/fill-ai",
  requirePermission("schedule.manage"),
  requireFeature("autoFill"),
  fillAutoScheduleDraftAssignmentWithAI,
);
router.post(
  "/draft-schedules/:draftId/publish",
  requirePermission("schedule.manage"),
  requireFeature("autoFill"),
  publishAutoScheduleDraft,
);
router.post(
  "/draft-schedules/:draftId/discard",
  requirePermission("schedule.manage"),
  requireFeature("autoFill"),
  discardAutoScheduleDraft,
);

// CALL-OUT (scheduler marks someone out; returns who can cover)
router.post(
  "/:id/call-out",
  requirePermission("schedule.manage"),
  markCallOut,
);

// SHIFT SWAP REQUESTS (schedulers approve; staff use their link)
router.get("/swap-requests", getShiftSwapRequests);
router.post("/swap-requests/:swapRequestId/respond", respondToShiftSwapRequest);
router.post("/:id/swap-requests", requestShiftSwap);

router.get("/:id", requirePermission("schedule.view"), getScheduleById);

// PUT /api/v1/schedules/:id  (body.notify: false for a quiet edit)
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
