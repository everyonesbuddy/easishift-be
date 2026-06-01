const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const mongoose = require("mongoose");

// Normalize to UTC midnight
function normalizeToUTC(date) {
  const d = new Date(date);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function normalizeShiftWindow(startTime, endTime) {
  const parsedStart = new Date(startTime);
  const parsedEnd = new Date(endTime);

  if (
    Number.isNaN(parsedStart.getTime()) ||
    Number.isNaN(parsedEnd.getTime())
  ) {
    return { error: "invalid_start_or_end" };
  }

  let normalizedEnd = parsedEnd;
  // Treat end <= start as an overnight shift that ends the following day.
  if (normalizedEnd <= parsedStart) {
    normalizedEnd = new Date(normalizedEnd.getTime() + 24 * 60 * 60 * 1000);
  }

  return {
    startTime: parsedStart,
    endTime: normalizedEnd,
  };
}

function normalizeAreaTag(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeShiftType(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function inferShiftTypeFromWindow(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const startHour = start.getUTCHours();
  const crossesMidnight = end.getUTCDate() !== start.getUTCDate();

  if (crossesMidnight || startHour >= 23 || startHour < 7) {
    return "night";
  }

  if (startHour >= 15 && startHour < 23) {
    return "evening";
  }

  return "day";
}

function getLegacyAreaFromRole(role) {
  const value = String(role || "")
    .trim()
    .toLowerCase();
  if (value.startsWith("al_")) return "AL";
  if (value.startsWith("il_")) return "IL";
  if (value.startsWith("mc_")) return "MC";
  return null;
}

function dedupeStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function getCoverageArea(coverage) {
  return normalizeAreaTag(
    coverage?.unitArea || getLegacyAreaFromRole(coverage?.role) || "",
  );
}

function getCoverageShiftType(coverage) {
  return normalizeShiftType(coverage?.shiftType || "");
}

async function getAllowedCoverageRoles(tenantId) {
  const prefs = await FacilityPreferences.findOne({ tenantId })
    .select("roleFamilies")
    .lean();

  return new Set(
    (prefs?.roleFamilies || [])
      .map((value) =>
        String(value || "")
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
}

function isOvernightShift(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return false;
  }

  return (
    start.getUTCFullYear() !== end.getUTCFullYear() ||
    start.getUTCMonth() !== end.getUTCMonth() ||
    start.getUTCDate() !== end.getUTCDate()
  );
}

function withOvernightFlag(coverage) {
  const plain =
    coverage && typeof coverage.toObject === "function"
      ? coverage.toObject()
      : { ...coverage };

  return {
    ...plain,
    spansOvernight: isOvernightShift(plain.startTime, plain.endTime),
  };
}

function formatDuplicateSchedule({
  date,
  role,
  unitArea,
  shiftType,
  startTime,
  endTime,
}) {
  return {
    date: new Date(date).toISOString(),
    role,
    unitArea: unitArea || null,
    shiftType: shiftType || null,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
  };
}

function buildDuplicateSummary(duplicates) {
  const preview = duplicates.slice(0, 3).map((item) => {
    const areaLabel = item.unitArea ? ` | ${item.unitArea}` : "";
    const shiftLabel = item.shiftType ? ` | ${item.shiftType}` : "";
    return `${item.role}${areaLabel}${shiftLabel} (${item.date} | ${item.startTime} - ${item.endTime})`;
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
    const allowedRoles = await getAllowedCoverageRoles(req.tenantId);

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

    const normalizedShifts = [];
    for (const [index, shift] of shifts.entries()) {
      if (!shift || typeof shift !== "object") {
        return res.status(400).json({
          message: `Shift at index ${index} must be an object`,
        });
      }

      const {
        role,
        unitArea,
        shiftType,
        requiredCount,
        requiredCertificationTags,
        startTime,
        endTime,
      } = shift;
      const normalizedRole = String(role || "")
        .trim()
        .toLowerCase();

      if (!role || !startTime || !endTime) {
        return res.status(400).json({
          message: `Shift at index ${index} must include role, startTime, and endTime`,
        });
      }

      if (!allowedRoles.has(normalizedRole)) {
        return res.status(400).json({
          message: `Shift at index ${index} has invalid role '${role || ""}'`,
        });
      }

      const normalizedWindow = normalizeShiftWindow(startTime, endTime);
      if (normalizedWindow.error) {
        return res.status(400).json({
          message: `Shift at index ${index} has invalid startTime or endTime`,
        });
      }

      if (requiredCount !== undefined && Number(requiredCount) < 0) {
        return res.status(400).json({
          message: `Shift at index ${index} has invalid requiredCount`,
        });
      }

      normalizedShifts.push({
        role: normalizedRole,
        unitArea: normalizeAreaTag(unitArea || getLegacyAreaFromRole(role)),
        shiftType: normalizeShiftType(
          shiftType || inferShiftTypeFromWindow(startTime, endTime),
        ),
        requiredCertificationTags: dedupeStrings(requiredCertificationTags),
        requiredCount,
        note: shift.note,
        startTime: normalizedWindow.startTime,
        endTime: normalizedWindow.endTime,
      });
    }

    const docs = [];
    const requestKeys = new Set();
    const duplicateRequestMap = new Map();
    for (const date of normalizedDates) {
      for (const shift of normalizedShifts) {
        const { startTime, endTime } = shift;
        const uniqueKey = `${date.toISOString()}-${shift.role}-${shift.unitArea || ""}-${shift.shiftType || ""}-${startTime.toISOString()}-${endTime.toISOString()}`;
        const duplicateItem = formatDuplicateSchedule({
          date,
          role: shift.role,
          unitArea: shift.unitArea,
          shiftType: shift.shiftType,
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
          unitArea: shift.unitArea || null,
          shiftType: shift.shiftType || null,
          startTime,
          endTime,
          requiredCount:
            shift.requiredCount !== undefined ? shift.requiredCount : 1,
          requiredCertificationTags: shift.requiredCertificationTags || [],
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
        unitArea: doc.unitArea,
        shiftType: doc.shiftType,
        startTime: doc.startTime,
        endTime: doc.endTime,
      })),
    })
      .select("date role unitArea shiftType startTime endTime")
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
    res.status(201).json(created.map(withOvernightFlag));
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
    if (req.query.unitArea)
      filter.unitArea = normalizeAreaTag(req.query.unitArea);
    if (req.query.shiftType)
      filter.shiftType = normalizeShiftType(req.query.shiftType);

    const list = await Coverage.find(filter).sort({ date: 1, startTime: 1 });
    res.json(list.map(withOvernightFlag));
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
    const allowedRoles = await getAllowedCoverageRoles(req.tenantId);

    if (update.date) update.date = normalizeToUTC(update.date);

    if (update.role !== undefined) {
      const normalizedRole = String(update.role || "")
        .trim()
        .toLowerCase();
      if (!allowedRoles.has(normalizedRole)) {
        return res.status(400).json({
          message: `invalid role '${update.role || ""}'`,
        });
      }
      update.role = normalizedRole;
    }

    const existing = await Coverage.findOne({
      _id: id,
      tenantId: req.tenantId,
    });
    if (!existing)
      return res.status(404).json({ message: "Coverage not found" });

    if (update.startTime !== undefined || update.endTime !== undefined) {
      const startTimeInput =
        update.startTime !== undefined ? update.startTime : existing.startTime;
      const endTimeInput =
        update.endTime !== undefined ? update.endTime : existing.endTime;

      const normalizedWindow = normalizeShiftWindow(
        startTimeInput,
        endTimeInput,
      );
      if (normalizedWindow.error) {
        return res.status(400).json({
          message: "Invalid startTime or endTime",
        });
      }

      update.startTime = normalizedWindow.startTime;
      update.endTime = normalizedWindow.endTime;
    }

    const updated = await Coverage.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId },
      update,
      { new: true },
    );

    res.json(withOvernightFlag(updated));
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

// DELETE multiple coverages by ids
exports.deleteCoveragesByIds = async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admins only" });

    const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    if (!ids || !ids.length) {
      return res.status(400).json({
        message: "ids is required and must be a non-empty array",
      });
    }

    const uniqueIds = [...new Set(ids.map((id) => String(id).trim()))];
    const invalidIds = uniqueIds.filter((id) => !mongoose.isValidObjectId(id));

    if (invalidIds.length) {
      return res.status(400).json({
        message: "One or more ids are invalid",
        invalidIds,
      });
    }

    const existing = await Coverage.find({
      tenantId: req.tenantId,
      _id: { $in: uniqueIds },
    })
      .select("_id")
      .lean();

    const existingIdSet = new Set(existing.map((item) => String(item._id)));
    const notFoundIds = uniqueIds.filter((id) => !existingIdSet.has(id));

    let deletedCount = 0;
    if (existing.length) {
      const deleteResult = await Coverage.deleteMany({
        tenantId: req.tenantId,
        _id: { $in: existing.map((item) => item._id) },
      });
      deletedCount = deleteResult.deletedCount || 0;
    }

    return res.status(200).json({
      message: "Bulk delete completed",
      requestedCount: uniqueIds.length,
      deletedCount,
      notFoundCount: notFoundIds.length,
      notFoundIds,
    });
  } catch (err) {
    next(err);
  }
};

// GET unfilled coverage
exports.getUnfilledCoverage = async (req, res, next) => {
  try {
    const { role, unitArea, shiftType } = req.query;
    const tenantId = req.tenantId;

    if (!role) return res.status(400).json({ message: "role is required" });

    // 1. Get all coverages for this role
    const coveragesFilter = {
      tenantId,
      role,
    };
    if (unitArea) coveragesFilter.unitArea = normalizeAreaTag(unitArea);
    if (shiftType) coveragesFilter.shiftType = normalizeShiftType(shiftType);

    const coverages = await Coverage.find(coveragesFilter).sort({
      date: 1,
      startTime: 1,
    });

    if (!coverages.length) return res.json([]);

    // 2. Get schedules that match these coverage times
    const coverageIds = coverages.map((c) => c._id.toString());

    const schedules = await Schedule.find({
      tenantId,
      role,
      ...(unitArea ? { unitArea: normalizeAreaTag(unitArea) } : {}),
      ...(shiftType ? { shiftType: normalizeShiftType(shiftType) } : {}),
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
        ...withOvernightFlag(cov),
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
    const { role, unitArea, shiftType } = req.query; // optional
    const tenantId = req.tenantId;

    // 1. Get all coverages, optionally filtered by role
    const filter = { tenantId };
    if (role) filter.role = role;
    if (unitArea) filter.unitArea = normalizeAreaTag(unitArea);
    if (shiftType) filter.shiftType = normalizeShiftType(shiftType);

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
    if (unitArea) scheduleQuery.unitArea = normalizeAreaTag(unitArea);
    if (shiftType) scheduleQuery.shiftType = normalizeShiftType(shiftType);

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
        ...withOvernightFlag(cov),
        assignedCount: assigned,
        remaining: Math.max(0, cov.requiredCount - assigned),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};
