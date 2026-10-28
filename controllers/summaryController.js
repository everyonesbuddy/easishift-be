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
          status: { $nin: ["left_early", "no_show", "call_out", "cancelled"] },
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
    // The route already requires staff.view; this only checks the id is a
    // user in the same workspace (owners have role "owner", not "admin").
    const admin = await User.findOne({ _id: adminId, tenantId });
    if (!admin) {
      return res
        .status(403)
        .json({ message: "Admin not found or not authorized" });
    }

    const todayStart = startOfDayUTC();
    const todayEnd = endOfDayUTC();

    // Fetch today's schedules and coverages in parallel.
    // Use interval overlap (not exact date match) so overnight windows
    // crossing midnight are included in today's summary.
    const [schedulesToday, coverageToday, pendingTimeOffCount, staffCount] =
      await Promise.all([
        Schedule.find({
          tenantId,
          startTime: { $lte: todayEnd },
          endTime: { $gt: todayStart },
          status: { $nin: ["left_early", "no_show", "call_out", "cancelled"] },
        }).populate("staffId", "name role"),

        Coverage.find({
          tenantId,
          startTime: { $lte: todayEnd },
          endTime: { $gt: todayStart },
        }),

        TimeOff.countDocuments({ tenantId, status: "pending" }),

        User.countDocuments({ tenantId, loginEnabled: false, status: "active" }),
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

/* ---------------------------------------------------------
   TODAY (the scheduler's home page)
   GET /api/v1/summary/today

   What needs doing today and over the next two days, in the facility's
   time zone: open spots (with who's on them, so the website can open the
   usual slot drawer to fill them), call-outs, today's shifts and how full
   they are, who's on right now, and requests waiting on a decision.
--------------------------------------------------------- */
exports.getToday = async (req, res, next) => {
  try {
    // Required here so the older summary routes don't pull these in.
    const { DateTime } = require("luxon");
    const ShiftSwap = require("../models/shiftSwapModel");
    const FacilityPreferences = require("../models/facilityPreferencesModel");
    const { getWeekSettings, ensureWeek } = require("../utils/weekService");
    const { weekStartFor, dateKeyToCoverageDate, coverageDateToKey } = require("../utils/dateUtils");
    const { countAssignmentsByCoverage } = require("../utils/scheduleUtils");
    const { hasPermission } = require("../config/authorization");

    const tenantId = req.tenantId;
    const now = new Date();
    const settings = await getWeekSettings(tenantId);
    const zone = settings.timezone || "UTC";
    const local = DateTime.fromJSDate(now, { zone });
    const days = [0, 1, 2].map((i) => local.plus({ days: i }).toISODate());
    const from = local.startOf("day").toJSDate();
    const to = local.plus({ days: 3 }).startOf("day").toJSDate();

    // Open the weeks these days fall in (creates needs from Weekly Needs the
    // first time, like opening the week on the schedule).
    const weekKeys = [...new Set(days.map((d) => weekStartFor(DateTime.fromISO(d, { zone }).toJSDate(), zone, settings.weekStartsOn)))];
    const weeks = await Promise.all(weekKeys.map((weekStart) => ensureWeek({ tenantId, weekStart, settings })));
    const weekByKey = new Map(weekKeys.map((k, i) => [k, weeks[i]]));
    const weekOfDay = (d) => weekStartFor(DateTime.fromISO(d, { zone }).toJSDate(), zone, settings.weekStartsOn);

    const canReviewTimeOff = hasPermission(req.user, "timeoff.review");
    const canManage = hasPermission(req.user, "schedule.manage");

    const [prefs, coverage, schedules, timeOff, swaps] = await Promise.all([
      FacilityPreferences.findOne({ tenantId }).select("shiftTypeDefinitions").lean(),
      Coverage.find({ tenantId, date: { $in: days.map(dateKeyToCoverageDate) } }).sort({ startTime: 1 }).lean(),
      Schedule.find({ tenantId, startTime: { $lt: to }, endTime: { $gt: from } })
        .populate("staffId", "name roles")
        .sort({ startTime: 1 })
        .lean(),
      canReviewTimeOff
        ? TimeOff.find({ tenantId, status: "pending" }).populate("staffId", "name").sort({ startTime: 1 }).limit(20).lean()
        : [],
      canManage
        ? ShiftSwap.find({ tenantId, status: "pending_admin" })
            .populate("requesterStaffId", "name")
            .populate("receiverStaffId", "name")
            .populate("scheduleId", "role startTime endTime")
            .sort({ createdAt: 1 })
            .limit(20)
            .lean()
        : [],
    ]);
    const assigned = await countAssignmentsByCoverage({ tenantId, coverageIds: coverage.map((c) => c._id) });

    const labels = new Map();
    for (const def of prefs?.shiftTypeDefinitions || []) {
      for (const slot of def.timeSlots || []) {
        labels.set(`${String(def.key).toLowerCase()}:${String(slot.tag).toLowerCase()}`, slot.label || def.label || def.key);
      }
    }
    const shiftLabel = (type, tag) =>
      labels.get(`${String(type || "").toLowerCase()}:${String(tag || "").toLowerCase()}`) || (type ? String(type) : "Other");

    const peopleBySlot = new Map();
    const callOutsBySlot = new Map();
    for (const s of schedules) {
      if (!s.coverageId) continue;
      const key = String(s.coverageId);
      const map = s.status === "call_out" ? callOutsBySlot : peopleBySlot;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }

    const rows = coverage.map((c) => {
      const assignedCount = assigned.get(String(c._id)) || 0;
      const dateKey = coverageDateToKey(c.date);
      const weekStart = weekOfDay(dateKey);
      return {
        ...c,
        dateKey,
        weekStart,
        weekPublished: weekByKey.get(weekStart)?.status === "published",
        label: shiftLabel(c.shiftType, c.shiftTag),
        assignedCount,
        open: new Date(c.endTime) > now ? Math.max(0, c.requiredCount - assignedCount) : 0,
        isPast: new Date(c.endTime) <= now,
        people: peopleBySlot.get(String(c._id)) || [],
        callOuts: (callOutsBySlot.get(String(c._id)) || []).length,
      };
    });

    // Today's shifts: one line per shift time, all roles together.
    const todayShifts = new Map();
    for (const r of rows.filter((x) => x.dateKey === days[0])) {
      const key = `${r.shiftType || ""}:${r.shiftTag || ""}:${new Date(r.startTime).toISOString()}`;
      if (!todayShifts.has(key)) {
        todayShifts.set(key, { key, label: r.label, startTime: r.startTime, endTime: r.endTime, required: 0, assigned: 0, open: 0, roles: new Map() });
      }
      const g = todayShifts.get(key);
      g.required += r.requiredCount;
      g.assigned += Math.min(r.requiredCount, r.assignedCount);
      g.open += r.open;
      const role = g.roles.get(r.role) || { role: r.role, required: 0, assigned: 0 };
      role.required += r.requiredCount;
      role.assigned += Math.min(r.requiredCount, r.assignedCount);
      g.roles.set(r.role, role);
    }

    const working = schedules.filter((s) => !["call_out", "no_show", "cancelled"].includes(s.status));
    const onNow = working.filter((s) => new Date(s.startTime) <= now && new Date(s.endTime) > now);
    const callOuts = schedules
      .filter((s) => s.status === "call_out" && new Date(s.endTime) > now)
      .map((s) => {
        const slot = s.coverageId ? rows.find((r) => String(r._id) === String(s.coverageId)) : null;
        return {
          _id: s._id,
          name: s.staffId?.name || "Someone",
          role: s.role,
          startTime: s.startTime,
          endTime: s.endTime,
          label: shiftLabel(s.shiftType, s.shiftTag),
          coverageId: s.coverageId || null,
          // Still open on that spot (null when it isn't tied to one).
          stillOpen: slot ? slot.open : null,
        };
      });

    res.json({
      timezone: zone,
      days,
      now: now.toISOString(),
      openSlots: rows.filter((r) => r.open > 0),
      todayShifts: [...todayShifts.values()].map((g) => ({ ...g, roles: [...g.roles.values()] })),
      onNow: {
        count: onNow.length,
        byRole: Object.entries(
          onNow.reduce((acc, s) => ({ ...acc, [s.role || "other"]: (acc[s.role || "other"] || 0) + 1 }), {}),
        ).map(([role, count]) => ({ role, count })),
      },
      callOuts,
      timeOff: timeOff.map((t) => ({
        _id: t._id,
        name: t.staffId?.name || "Someone",
        startTime: t.startTime,
        endTime: t.endTime,
        reason: t.reason || "",
      })),
      swaps: swaps.map((s) => ({
        _id: s._id,
        from: s.requesterStaffId?.name || "Someone",
        to: s.receiverStaffId?.name || null,
        role: s.scheduleId?.role || null,
        startTime: s.scheduleId?.startTime || null,
        endTime: s.scheduleId?.endTime || null,
      })),
      totals: {
        openToday: rows.filter((r) => r.dateKey === days[0]).reduce((n, r) => n + r.open, 0),
        openNextTwoDays: rows.filter((r) => r.dateKey !== days[0]).reduce((n, r) => n + r.open, 0),
        shiftsToday: working.filter((s) => DateTime.fromJSDate(new Date(s.startTime), { zone }).toISODate() === days[0]).length,
      },
      can: { manage: canManage, reviewTimeOff: canReviewTimeOff },
    });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
    next(err);
  }
};
