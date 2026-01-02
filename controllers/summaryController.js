// controllers/summaryController.js
const Schedule = require("../models/scheduleModel");
const Coverage = require("../models/coverageModel");
const User = require("../models/userModel");
const Message = require("../models/messageModel");
const TimeOff = require("../models/timeOffModel");

// Helpers for date boundaries in UTC
function startOfDayUTC() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfDayUTC() {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function startOfWeekUTC() {
  const d = new Date();
  const day = d.getUTCDay(); // 0 (Sun) - 6 (Sat)
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfWeekUTC() {
  const s = startOfWeekUTC();
  s.setUTCDate(s.getUTCDate() + 6);
  s.setUTCHours(23, 59, 59, 999);
  return s;
}

/* ---------------------------------------------------------
   STAFF SUMMARY (For any staff or admin-as-staff)
   GET /api/v1/summary/staff/:staffId
--------------------------------------------------------- */
exports.getStaffSummary = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const staffId = req.params.staffId;

    // Ensure the staff belongs to this tenant
    const staff = await User.findOne({ _id: staffId, tenantId });
    if (!staff) {
      return res.status(404).json({ message: "Staff not found for tenant" });
    }

    const todayStart = startOfDayUTC();
    const todayEnd = endOfDayUTC();

    // Counts for staff
    const [unreadMessages, approvedUpcomingTimeOffCount, schedulesThisWeek] =
      await Promise.all([
        // Unread messages for this staff member
        Message.countDocuments({ tenantId, receiverId: staffId, read: false }),

        // Approved time-off for this staff that hasn't finished yet
        TimeOff.countDocuments({
          tenantId,
          staffId,
          status: "approved",
          endTime: { $gte: todayStart },
        }),

        // Schedules for the current week for this staff
        Schedule.find({
          tenantId,
          staffId,
          startTime: { $gte: startOfWeekUTC(), $lte: endOfWeekUTC() },
          status: { $ne: "cancelled" },
        }).sort({ startTime: 1 }),
      ]);

    // Compute hours this week from schedulesThisWeek
    let hoursThisWeek = 0;
    schedulesThisWeek.forEach((s) => {
      if (s.startTime && s.endTime && s.endTime > s.startTime) {
        hoursThisWeek +=
          (s.endTime.getTime() - s.startTime.getTime()) / (1000 * 60 * 60);
      }
    });

    res.json({
      staffId,
      staffRole: staff.role,
      unreadMessages,
      approvedUpcomingTimeOffCount,
      shiftsThisWeekCount: schedulesThisWeek.length,
      hoursThisWeek: Math.round(hoursThisWeek * 100) / 100, // 2 decimals
    });
  } catch (err) {
    next(err);
  }
};

/* ---------------------------------------------------------
   ADMIN SUMMARY (Entire Tenant Overview)
   GET /api/v1/summary/admin/:adminId
--------------------------------------------------------- */
exports.getAdminSummary = async (req, res, next) => {
  try {
    const tenantId = req.tenantId;
    const adminId = req.params.adminId;

    // Validate admin belongs to tenant
    const admin = await User.findOne({ _id: adminId, tenantId });
    if (!admin || admin.role !== "admin") {
      return res
        .status(403)
        .json({ message: "Admin not found or not authorized" });
    }

    const todayStart = startOfDayUTC();
    const todayEnd = endOfDayUTC();

    // Fetch today's schedules and coverages in parallel
    const [schedulesToday, coverageToday, pendingTimeOffCount, staffCount] =
      await Promise.all([
        Schedule.find({
          tenantId,
          startTime: { $gte: todayStart, $lte: todayEnd },
          status: { $ne: "cancelled" },
        }).populate("staffId", "name role"),

        Coverage.find({ tenantId, date: todayStart }),

        TimeOff.countDocuments({ tenantId, status: "pending" }),

        User.countDocuments({ tenantId }),
      ]);

    // Build a map of assigned schedules per coverage key (role-start-end)
    const scheduleCountMap = {};
    schedulesToday.forEach((s) => {
      const key = `${
        s.role || ""
      }-${s.startTime.toISOString()}-${s.endTime.toISOString()}`;
      scheduleCountMap[key] = (scheduleCountMap[key] || 0) + 1;
    });

    let fullyStaffedCount = 0;
    let understaffedCount = 0;

    coverageToday.forEach((cov) => {
      const key = `${
        cov.role || ""
      }-${cov.startTime.toISOString()}-${cov.endTime.toISOString()}`;
      const assigned = scheduleCountMap[key] || 0;
      if (assigned >= (cov.requiredCount || 0)) fullyStaffedCount++;
      else understaffedCount++;
    });

    res.json({
      adminId,
      activeStaffCount: staffCount,
      schedulesTodayCount: schedulesToday.length,
      coverageTodayCount: coverageToday.length,
      fullyStaffedCount,
      understaffedCount,
      pendingTimeOffCount,
    });
  } catch (err) {
    next(err);
  }
};
