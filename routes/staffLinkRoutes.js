/**
 * Staff link routes — /api/v1/s/:token/...
 * No login: the token in the URL identifies the staff member.
 */
const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router({ mergeParams: true });

const staffLink = require("../middleware/staffLinkMiddleware");
const { requireFeature } = require("../middleware/planMiddleware");
const portal = require("../controllers/staffPortalController");
const schedule = require("../controllers/scheduleController");
const timeOff = require("../controllers/timeOffController");
const preferences = require("../controllers/preferencesController");
const timeTracking = require("../controllers/timeTrackingController");

router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message: "Too many requests, slow down a little." },
  }),
);
router.use(staffLink);

router.get("/me", portal.getMe);
router.get("/schedule", portal.getMySchedule);

// Open shifts (Pro)
router.get("/open-shifts", requireFeature("pickup"), schedule.getOpenCoverageForMe);
router.post("/open-shifts/pick-up", requireFeature("pickup"), schedule.pickUpSchedule);

// Swaps (Pro)
router.get("/swap-candidates/:scheduleId", requireFeature("swaps"), portal.getSwapCandidates);
router.post("/schedules/:id/swap", requireFeature("swaps"), schedule.requestShiftSwap);
router.get("/swaps", requireFeature("swaps"), schedule.getShiftSwapRequests);
router.post("/swaps/:swapRequestId/respond", requireFeature("swaps"), schedule.respondToShiftSwapRequest);

// Can't make it
router.post("/schedules/:id/call-out", (req, res, next) => {
  req.body = { ...(req.body || {}), status: "call_out" };
  return schedule.updateOwnScheduleStatus(req, res, next);
});

// Time off and preferences
router.get("/time-off", timeOff.getTimeOff);
router.post("/time-off", timeOff.requestTimeOff);
router.get("/preferences", preferences.getMyPreferences);
router.post("/preferences", preferences.upsertMyPreferences);

// Messages from the facility (Facility plan)
router.get("/messages", requireFeature("messaging"), portal.getMyMessages);

// Clock in/out (Facility plan)
router.get("/time-entries", requireFeature("timeClock"), timeTracking.getMyTimeEntries);
router.post("/clock-in", requireFeature("timeClock"), timeTracking.clockIn);
router.post("/breaks/start", requireFeature("timeClock"), timeTracking.startBreak);
router.post("/breaks/end", requireFeature("timeClock"), timeTracking.endBreak);
router.post("/clock-out", requireFeature("timeClock"), timeTracking.clockOut);

module.exports = router;
