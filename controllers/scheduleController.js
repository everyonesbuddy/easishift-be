// controllers/scheduleController.js
const Schedule = require("../models/scheduleModel");
const Coverage = require("../models/coverageModel");
const Preferences = require("../models/preferencesModel");
const TimeOff = require("../models/timeOffModel");
const User = require("../models/userModel");
const { hasConflict } = require("../utils/scheduleUtils");

// AUTO-GENERATE SCHEDULE FOR SELECTED COVERAGES
exports.autoGenerateSchedule = async (req, res, next) => {
  try {
    const { coverageIds } = req.body;

    if (!coverageIds || !Array.isArray(coverageIds) || !coverageIds.length) {
      console.log("No coverageIds provided");
      return res.status(400).json({ message: "coverageIds are required" });
    }

    const tenantId = req.tenantId;

    // 1) GET COVERAGE DETAILS
    const coverageList = await Coverage.find({
      tenantId,
      _id: { $in: coverageIds },
    }).sort({ date: 1, startTime: 1 });

    if (!coverageList.length) {
      console.log("No valid coverage found");
      return res.status(404).json({ message: "No valid coverage found" });
    }

    console.log(`Found ${coverageList.length} coverage(s) to process`);

    // 2) LOAD TIME OFF
    const now = new Date();
    const end = new Date(Math.max(...coverageList.map((c) => c.endTime)));
    const start = new Date(Math.min(...coverageList.map((c) => c.startTime)));

    const timeOff = await TimeOff.find({
      tenantId,
      status: "approved",
      $or: [
        { start: { $lte: end }, end: { $gte: start } },
        { startDate: { $lte: end }, endDate: { $gte: start } },
      ],
    });

    const timeOffMap = {};
    timeOff.forEach((t) => {
      const id = t.staffId.toString();
      if (!timeOffMap[id]) timeOffMap[id] = [];
      timeOffMap[id].push(t);
    });

    console.log(`Loaded time-off records for ${timeOff.length} staff`);

    // 3) LOAD EXISTING SCHEDULES (ignore completed/cancelled so they don't block auto-generation)
    const existingSchedules = await Schedule.find({
      tenantId,
      status: { $nin: ["completed", "cancelled"] },
      startTime: { $gte: start, $lte: end },
    });

    const existingByStaff = {};
    existingSchedules.forEach((s) => {
      const id = s.staffId.toString();
      if (!existingByStaff[id]) existingByStaff[id] = [];
      existingByStaff[id].push(s);
    });

    const workload = {};
    existingSchedules.forEach((s) => {
      const minutes = (s.endTime - s.startTime) / 60000;
      workload[s.staffId] = (workload[s.staffId] || 0) + minutes;
    });

    console.log(
      `Loaded existing schedules for ${existingSchedules.length} shifts`
    );

    const generated = [];

    // 4) LOOP THROUGH COVERAGES
    for (const cov of coverageList) {
      console.log(
        `\nProcessing coverage: ${cov._id}, role: ${cov.role}, start: ${cov.startTime}, end: ${cov.endTime}`
      );

      const weekday = cov.date.getUTCDay();

      const roleStaff = await User.find({ tenantId, role: cov.role });
      if (!roleStaff.length) {
        console.log(`No staff found for role ${cov.role}`);
        continue;
      }

      const staffIds = roleStaff.map((u) => u._id.toString());

      const prefs = await Preferences.find({
        tenantId,
        staffId: { $in: staffIds },
      });

      const prefMap = {};
      prefs.forEach((p) => (prefMap[p.staffId.toString()] = p));

      // FILTER AVAILABLE STAFF
      let available = [];
      for (const staff of roleStaff) {
        const id = staff._id.toString();
        const pref = prefMap[id];
        let skipReason = null;

        if (pref?.unavailableDaysOfWeek?.includes(weekday)) {
          skipReason = `unavailable on weekday ${weekday}`;
        } else if (
          timeOffMap[id]?.some(
            (to) =>
              new Date(to.start) <= cov.endTime &&
              new Date(to.end) >= cov.startTime
          )
        ) {
          skipReason = `has approved time off overlapping coverage`;
        } else if (
          existingByStaff[id]?.some(
            (s) => !(s.endTime <= cov.startTime || s.startTime >= cov.endTime)
          )
        ) {
          skipReason = `already scheduled for overlapping shift`;
        } else if (
          existingByStaff[id]?.some(
            (s) => Math.abs(s.endTime - cov.startTime) < 30 * 60 * 1000
          )
        ) {
          skipReason = `less than 30 min break from previous shift`;
        }

        if (skipReason) {
          console.log(`Skipping staff ${staff.name} (${id}): ${skipReason}`);
        } else {
          available.push(staff);
          console.log(`Staff ${staff.name} (${id}) is available`);
        }
      }

      if (!available.length) {
        console.log("No available staff for this coverage");
        continue;
      }

      const alreadyAssigned = existingSchedules.filter(
        (s) =>
          s.role === cov.role &&
          s.startTime.getTime() === cov.startTime.getTime() &&
          s.endTime.getTime() === cov.endTime.getTime()
      );

      const needed = cov.requiredCount - alreadyAssigned.length;
      console.log(`${needed} staff needed for this coverage`);

      if (needed <= 0) {
        console.log("Coverage already fully assigned");
        continue;
      }

      available = available.sort(
        (a, b) => (workload[a._id] || 0) - (workload[b._id] || 0)
      );

      const selected = available.slice(0, needed);

      for (const staff of selected) {
        const newShift = await Schedule.create({
          tenantId,
          staffId: staff._id,
          role: cov.role,
          startTime: cov.startTime,
          endTime: cov.endTime,
          timezone: "UTC",
          notes: "Auto-generated",
          status: "scheduled",
          meta: { autoGenerated: true, createdBy: req.user._id },
        });

        console.log(
          `Assigned staff ${staff.name} (${staff._id}) to coverage ${cov._id}`
        );

        generated.push(newShift);

        const minutes = (cov.endTime - cov.startTime) / 60000;
        workload[staff._id] = (workload[staff._id] || 0) + minutes;

        existingSchedules.push(newShift);
        if (!existingByStaff[staff._id]) existingByStaff[staff._id] = [];
        existingByStaff[staff._id].push(newShift);
      }
    }

    console.log(
      `\nAuto-scheduling complete, ${generated.length} shift(s) generated`
    );

    res.json({
      message: "Auto-scheduling complete",
      generatedCount: generated.length,
      schedules: generated,
    });
  } catch (err) {
    console.error("Error in autoGenerateSchedule:", err);
    next(err);
  }
};

// CREATE SCHEDULE
exports.createSchedule = async (req, res, next) => {
  try {
    const { staffId, role, startTime, endTime, notes, timezone } = req.body;

    if (!staffId || !role || !startTime || !endTime)
      return res.status(400).json({
        message: "staffId, role, startTime, endTime are required",
      });

    // Check conflict
    const conflict = await hasConflict({
      tenantId: req.tenantId,
      staffId,
      startTime,
      endTime,
    });
    if (conflict)
      return res.status(409).json({ message: "Schedule conflict", conflict });

    const schedule = await Schedule.create({
      tenantId: req.tenantId,
      staffId,
      role,
      startTime,
      endTime,
      notes,
      timezone: timezone || "UTC",
      status: "scheduled",
      meta: { createdBy: req.user._id },
    });

    res.status(201).json(schedule);
  } catch (err) {
    next(err);
  }
};

// LIST SCHEDULES
exports.getSchedules = async (req, res, next) => {
  try {
    const { staffId, role, from, to } = req.query;

    const filter = { tenantId: req.tenantId };
    if (staffId) filter.staffId = staffId;
    if (role) filter.role = role;

    if (from || to) {
      filter.$and = [];
      if (from) filter.$and.push({ endTime: { $gte: new Date(from) } });
      if (to) filter.$and.push({ startTime: { $lte: new Date(to) } });
    }

    const schedules = await Schedule.find(filter)
      .populate("staffId", "-passwordHash")
      .sort({ startTime: 1 });

    res.json(schedules);
  } catch (err) {
    next(err);
  }
};

// GET ONE
exports.getScheduleById = async (req, res, next) => {
  try {
    const schedule = await Schedule.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    }).populate("staffId", "-passwordHash");

    if (!schedule)
      return res.status(404).json({ message: "Schedule not found" });

    res.json(schedule);
  } catch (err) {
    next(err);
  }
};

// UPDATE SCHEDULE
exports.updateSchedule = async (req, res, next) => {
  try {
    const updates = req.body;

    // If times change, check conflicts
    if (updates.startTime || updates.endTime || updates.staffId) {
      const sched = await Schedule.findById(req.params.id);
      if (!sched)
        return res.status(404).json({ message: "Schedule not found" });

      const startTime =
        updates.startTime !== undefined
          ? new Date(updates.startTime)
          : sched.startTime;

      const endTime =
        updates.endTime !== undefined
          ? new Date(updates.endTime)
          : sched.endTime;

      const staffId = updates.staffId || sched.staffId;

      const conflict = await hasConflict({
        tenantId: req.tenantId,
        staffId,
        startTime,
        endTime,
        excludeScheduleId: req.params.id,
      });

      if (conflict)
        return res.status(409).json({ message: "Schedule conflict", conflict });
    }

    const updated = await Schedule.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      updates,
      { new: true }
    ).populate("staffId", "-passwordHash");

    if (!updated)
      return res.status(404).json({ message: "Schedule not found" });

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// DELETE
exports.deleteSchedule = async (req, res, next) => {
  try {
    const deleted = await Schedule.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!deleted)
      return res.status(404).json({ message: "Schedule not found" });

    res.json({ message: "Schedule deleted" });
  } catch (err) {
    next(err);
  }
};
