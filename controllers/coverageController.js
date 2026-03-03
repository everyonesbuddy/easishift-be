const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");

// Normalize to UTC midnight
function normalizeToUTC(date) {
  const d = new Date(date);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function formatDuplicateSchedule({ date, role, startTime, endTime }) {
  return {
    date: new Date(date).toISOString(),
    role,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
  };
}

function buildDuplicateSummary(duplicates) {
  const preview = duplicates.slice(0, 3).map((item) => {
    return `${item.role} (${item.date} | ${item.startTime} - ${item.endTime})`;
  });

  const remaining = duplicates.length - preview.length;
  return remaining > 0
    ? `${preview.join(", ")}, and ${remaining} more`
    : preview.join(", ");
}

// CREATE
exports.createCoverage = async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admins only" });

    const { dates, shifts } = req.body;

    if (!Array.isArray(dates) || !dates.length) {
      return res
        .status(400)
        .json({ message: "dates is required and must be a non-empty array" });
    }

    if (!Array.isArray(shifts) || !shifts.length) {
      return res.status(400).json({
        message: "shifts is required and must be a non-empty array",
      });
    }

    const normalizedDates = dates.map((d) => normalizeToUTC(d));
    const hasInvalidDate = normalizedDates.some((d) =>
      Number.isNaN(d.getTime()),
    );
    if (hasInvalidDate) {
      return res.status(400).json({
        message: "One or more dates are invalid",
      });
    }

    for (const [index, shift] of shifts.entries()) {
      if (!shift || typeof shift !== "object") {
        return res.status(400).json({
          message: `Shift at index ${index} must be an object`,
        });
      }

      const { role, requiredCount, startTime, endTime } = shift;

      if (!role || !startTime || !endTime) {
        return res.status(400).json({
          message: `Shift at index ${index} must include role, startTime, and endTime`,
        });
      }

      const parsedStart = new Date(startTime);
      const parsedEnd = new Date(endTime);

      if (
        Number.isNaN(parsedStart.getTime()) ||
        Number.isNaN(parsedEnd.getTime())
      ) {
        return res.status(400).json({
          message: `Shift at index ${index} has invalid startTime or endTime`,
        });
      }

      if (parsedStart >= parsedEnd) {
        return res.status(400).json({
          message: `Shift at index ${index} must have endTime after startTime`,
        });
      }

      if (requiredCount !== undefined && Number(requiredCount) < 0) {
        return res.status(400).json({
          message: `Shift at index ${index} has invalid requiredCount`,
        });
      }
    }

    const docs = [];
    const requestKeys = new Set();
    const duplicateRequestMap = new Map();
    for (const date of normalizedDates) {
      for (const shift of shifts) {
        const startTime = new Date(shift.startTime);
        const endTime = new Date(shift.endTime);
        const uniqueKey = `${date.toISOString()}-${shift.role}-${startTime.toISOString()}-${endTime.toISOString()}`;
        const duplicateItem = formatDuplicateSchedule({
          date,
          role: shift.role,
          startTime,
          endTime,
        });

        if (requestKeys.has(uniqueKey)) {
          duplicateRequestMap.set(uniqueKey, duplicateItem);
          continue;
        }

        requestKeys.add(uniqueKey);
        docs.push({
          tenantId: req.tenantId,
          date,
          role: shift.role,
          startTime,
          endTime,
          requiredCount:
            shift.requiredCount !== undefined ? shift.requiredCount : 1,
          note: shift.note,
        });
      }
    }

    if (duplicateRequestMap.size) {
      const duplicates = Array.from(duplicateRequestMap.values());
      return res.status(400).json({
        status: "error",
        message: `Your request contains ${duplicates.length} duplicate schedule(s): ${buildDuplicateSummary(duplicates)}. Remove these duplicate entries and submit again, or use Edit if you need to change an existing schedule.`,
        duplicateType: "request",
        duplicates,
      });
    }

    const conflicts = await Coverage.find({
      tenantId: req.tenantId,
      $or: docs.map((doc) => ({
        date: doc.date,
        role: doc.role,
        startTime: doc.startTime,
        endTime: doc.endTime,
      })),
    })
      .select("date role startTime endTime")
      .lean();

    if (conflicts.length) {
      const duplicates = conflicts.map(formatDuplicateSchedule);
      return res.status(409).json({
        status: "error",
        message: `${duplicates.length} schedule(s) already exist: ${buildDuplicateSummary(duplicates)}. No new schedules were created. Remove these entries from your request, or click Edit on the existing schedule(s) to update them.`,
        duplicateType: "existing",
        duplicates,
      });
    }

    const created = await Coverage.insertMany(docs, { ordered: true });
    res.status(201).json(created);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        status: "error",
        message:
          "One or more schedules already exist. No new schedules were created. If you want to make changes, click the Edit button on the existing schedule instead of creating a new one.",
      });
    }

    next(err);
  }
};

// GET
exports.getCoverage = async (req, res, next) => {
  try {
    const filter = { tenantId: req.tenantId };

    if (req.query.date) {
      filter.date = normalizeToUTC(req.query.date);
    }

    if (req.query.month && req.query.year) {
      const y = Number(req.query.year);
      const m = Number(req.query.month);
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 1));
      filter.date = { $gte: start, $lt: end };
    }

    if (req.query.role) filter.role = req.query.role;

    const list = await Coverage.find(filter).sort({ date: 1, startTime: 1 });
    res.json(list);
  } catch (err) {
    next(err);
  }
};

// UPDATE
exports.updateCoverage = async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admins only" });

    const id = req.params.id;
    const update = { ...req.body };

    if (update.date) update.date = normalizeToUTC(update.date);

    const updated = await Coverage.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId },
      update,
      { new: true },
    );

    if (!updated)
      return res.status(404).json({ message: "Coverage not found" });

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// DELETE
exports.deleteCoverage = async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admins only" });

    const removed = await Coverage.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!removed)
      return res.status(404).json({ message: "Coverage not found" });

    res.json({ message: "Coverage deleted" });
  } catch (err) {
    next(err);
  }
};

// GET unfilled coverage
exports.getUnfilledCoverage = async (req, res, next) => {
  try {
    const { role } = req.query;
    const tenantId = req.tenantId;

    if (!role) return res.status(400).json({ message: "role is required" });

    // 1. Get all coverages for this role
    const coverages = await Coverage.find({
      tenantId,
      role,
    }).sort({ date: 1, startTime: 1 });

    if (!coverages.length) return res.json([]);

    // 2. Get schedules that match these coverage times
    const coverageIds = coverages.map((c) => c._id.toString());

    const schedules = await Schedule.find({
      tenantId,
      role,
      status: { $nin: ["completed", "call_out", "cancelled"] },
      $or: coverages.map((c) => ({
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    });

    // 3. Count how many staff are assigned per coverage
    const scheduleCountMap = {};

    schedules.forEach((s) => {
      const key = `${s.startTime.toISOString()}-${s.endTime.toISOString()}`;
      if (!scheduleCountMap[key]) scheduleCountMap[key] = 0;
      scheduleCountMap[key]++;
    });

    // 4. Build response
    const result = coverages.map((cov) => {
      const key = `${cov.startTime.toISOString()}-${cov.endTime.toISOString()}`;
      const assigned = scheduleCountMap[key] || 0;

      return {
        ...cov.toObject(),
        assignedCount: assigned,
        remaining: Math.max(0, cov.requiredCount - assigned),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};

// GET unfilled coverages for auto-generation
exports.getUnfilledCoverageForAuto = async (req, res, next) => {
  try {
    const { role } = req.query; // optional
    const tenantId = req.tenantId;

    // 1. Get all coverages, optionally filtered by role
    const filter = { tenantId };
    if (role) filter.role = role;

    const coverages = await Coverage.find(filter).sort({
      date: 1,
      startTime: 1,
    });

    if (!coverages.length) return res.json([]);

    // 2. Find schedules that match these coverage times.
    // If a role was provided, include it so we only count schedules for that role.
    const scheduleQuery = {
      tenantId,
      status: { $nin: ["completed", "call_out"] },
      $or: coverages.map((c) => ({
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    };

    if (role) scheduleQuery.role = role;

    const schedules = await Schedule.find(scheduleQuery);

    // 3. Count how many staff are assigned per coverage.
    // Use a composite key that includes role so schedules for different roles
    // but the same times don't get mixed together when `role` query is absent.
    const scheduleCountMap = {};
    schedules.forEach((s) => {
      const key = `${
        s.role || ""
      }-${s.startTime.toISOString()}-${s.endTime.toISOString()}`;
      if (!scheduleCountMap[key]) scheduleCountMap[key] = 0;
      scheduleCountMap[key]++;
    });

    // 4. Build response
    const result = coverages.map((cov) => {
      const key = `${
        cov.role || ""
      }-${cov.startTime.toISOString()}-${cov.endTime.toISOString()}`;
      const assigned = scheduleCountMap[key] || 0;
      return {
        ...cov.toObject(),
        assignedCount: assigned,
        remaining: Math.max(0, cov.requiredCount - assigned),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};
