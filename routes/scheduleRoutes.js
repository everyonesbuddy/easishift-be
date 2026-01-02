// routes/schedulesRoutes.js
const express = require("express");
const router = express.Router();
const {
  createSchedule,
  getSchedules,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
  autoGenerateSchedule,
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

router.get("/:id", getScheduleById);

// PUT /api/v1/schedules/:id  (admin or schedule owner -> allow update)
router.put("/:id", updateSchedule);

// DELETE /api/v1/schedules/:id
router.delete("/:id", restrictTo("admin"), deleteSchedule);

module.exports = router;
