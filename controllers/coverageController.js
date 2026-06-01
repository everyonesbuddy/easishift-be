const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const mongoose = require("mongoose");
const { DateTime } = require("luxon");

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

function normalizeShiftTag(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeFacilityTimezone(value) {
  const timezone = String(value || "UTC").trim();
  return DateTime.local().setZone(timezone).isValid ? timezone : "UTC";
}

function parseClockTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
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

function getConfiguredShiftTypes(facilityPrefs) {
  const fromLegacyList = dedupeStrings(facilityPrefs?.shiftTypes || []).map(
    normalizeShiftType,
  );
  const fromDefinitions = dedupeStrings(
    (facilityPrefs?.shiftTypeDefinitions || []).map((item) => item?.key),
  ).map(normalizeShiftType);

  const merged = dedupeStrings([...fromLegacyList, ...fromDefinitions]);
  if (merged.length) return merged;
  return ["day", "evening", "night"];
}

function buildShiftSlotLookup(facilityPrefs) {
  const lookup = new Map();

  for (const definition of facilityPrefs?.shiftTypeDefinitions || []) {
    const shiftType = normalizeShiftType(definition?.key);
    if (!shiftType) continue;

    for (const slot of definition?.timeSlots || []) {
      const shiftTag = normalizeShiftTag(slot?.tag);
      if (!shiftTag) continue;

      const startLocal = String(slot?.startLocalTime || "").trim();
      const endLocal = String(slot?.endLocalTime || "").trim();
      if (!startLocal || !endLocal) continue;

      lookup.set(`${shiftType}:${shiftTag}`, {
        shiftType,
        shiftTag,
        startLocalTime: startLocal,
        endLocalTime: endLocal,
        spansOvernight: Boolean(slot?.spansOvernight),
      });
    }
  }

  return lookup;
}

function buildWindowFromShiftSlot({
  date,
  shiftType,
  shiftTag,
  slotLookup,
  facilityTimezone,
}) {
  const slot = slotLookup.get(`${shiftType}:${shiftTag}`);
  if (!slot) {
    return {
      error: `No shift slot configuration found for shiftType '${shiftType}' and shiftTag '${shiftTag}'`,
    };
  }

  const startClock = parseClockTime(slot.startLocalTime);
  const endClock = parseClockTime(slot.endLocalTime);
  if (!startClock || !endClock) {
    return {
      error: `Invalid local slot time configuration for shiftType '${shiftType}' and shiftTag '${shiftTag}'`,
    };
  }

  const anchorDate = new Date(date);
  const year = anchorDate.getUTCFullYear();
  const month = anchorDate.getUTCMonth() + 1;
  const day = anchorDate.getUTCDate();

  const localStart = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour: startClock.hour,
      minute: startClock.minute,
      second: 0,
      millisecond: 0,
    },
    { zone: facilityTimezone },
  );

  let localEnd = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour: endClock.hour,
      minute: endClock.minute,
      second: 0,
      millisecond: 0,
    },
    { zone: facilityTimezone },
  );

  if (!localStart.isValid || !localEnd.isValid) {
    return {
      error: `Failed to parse local slot window for shiftType '${shiftType}' and shiftTag '${shiftTag}' in timezone '${facilityTimezone}'`,
    };
  }

  if (slot.spansOvernight || localEnd <= localStart) {
    localEnd = localEnd.plus({ days: 1 });
  }

  return {
    startTime: localStart.toUTC().toJSDate(),
    endTime: localEnd.toUTC().toJSDate(),
  };
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

async function getCoverageConfig(tenantId) {
  const prefs = await FacilityPreferences.findOne({ tenantId })
    .select("roleFamilies shiftTypes shiftTypeDefinitions facilityTimezone")
    .lean();

  return {
    allowedRoles: new Set(
      (prefs?.roleFamilies || [])
        .map((value) =>
          String(value || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
    allowedShiftTypes: new Set(getConfiguredShiftTypes(prefs)),
    slotLookup: buildShiftSlotLookup(prefs),
    facilityTimezone: normalizeFacilityTimezone(prefs?.facilityTimezone),
  };
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
  shiftTag,
  startTime,
  endTime,
}) {
  return {
    date: new Date(date).toISOString(),
    role,
    unitArea: unitArea || null,
    shiftType: shiftType || null,
    shiftTag: shiftTag || null,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
  };
}

function buildDuplicateSummary(duplicates) {
  const preview = duplicates.slice(0, 3).map((item) => {
    const areaLabel = item.unitArea ? ` | ${item.unitArea}` : "";
    const shiftLabel = item.shiftType ? ` | ${item.shiftType}` : "";
    const shiftTagLabel = item.shiftTag ? ` | ${item.shiftTag}` : "";
    return `${item.role}${areaLabel}${shiftLabel}${shiftTagLabel} (${item.date} | ${item.startTime} - ${item.endTime})`;
  });

  const remaining = duplicates.length - preview.length;
  return remaining > 0
    ? `${preview.join(", ")}, and ${remaining} more`
    : preview.join(", ");
}

function buildCoverageMatchKey(item) {
  return [
    item.role || "",
    item.unitArea || "",
    item.shiftType || "",
    item.shiftTag || "",
    new Date(item.startTime).toISOString(),
    new Date(item.endTime).toISOString(),
  ].join("-");
}

// CREATE
exports.createCoverage = async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admins only" });

    const { dates, shifts } = req.body;
    const { allowedRoles, allowedShiftTypes, slotLookup, facilityTimezone } =
      await getCoverageConfig(req.tenantId);

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
        shiftTag,
        requiredCount,
        requiredCertificationTags,
        startTime,
        endTime,
      } = shift;
      const normalizedRole = String(role || "")
        .trim()
        .toLowerCase();

      if (!role) {
        return res.status(400).json({
          message: `Shift at index ${index} must include role`,
        });
      }

      if (!allowedRoles.has(normalizedRole)) {
        return res.status(400).json({
          message: `Shift at index ${index} has invalid role '${role || ""}'`,
        });
      }

      const normalizedShiftType = normalizeShiftType(shiftType);
      const normalizedShiftTag = normalizeShiftTag(shiftTag);

      if (
        normalizedShiftType &&
        allowedShiftTypes.size &&
        !allowedShiftTypes.has(normalizedShiftType)
      ) {
        return res.status(400).json({
          message: `Shift at index ${index} has invalid shiftType '${shiftType || ""}'`,
        });
      }

      if (Boolean(normalizedShiftType) !== Boolean(normalizedShiftTag)) {
        return res.status(400).json({
          message: `Shift at index ${index} must include both shiftType and shiftTag together`,
        });
      }

      if (!normalizedShiftType && (!startTime || !endTime)) {
        return res.status(400).json({
          message: `Shift at index ${index} must include startTime/endTime when shiftType is not selected`,
        });
      }

      if (normalizedShiftType && normalizedShiftTag) {
        const slot = slotLookup.get(
          `${normalizedShiftType}:${normalizedShiftTag}`,
        );
        if (!slot) {
          return res.status(400).json({
            message: `Shift at index ${index} has unknown shiftTag '${shiftTag || ""}' for shiftType '${shiftType || ""}'`,
          });
        }
      }

      if (requiredCount !== undefined && Number(requiredCount) < 0) {
        return res.status(400).json({
          message: `Shift at index ${index} has invalid requiredCount`,
        });
      }

      normalizedShifts.push({
        role: normalizedRole,
        unitArea: normalizeAreaTag(unitArea || getLegacyAreaFromRole(role)),
        shiftType: normalizedShiftType || null,
        shiftTag: normalizedShiftTag || null,
        requiredCertificationTags: dedupeStrings(requiredCertificationTags),
        requiredCount,
        note: shift.note,
        startTime,
        endTime,
      });
    }

    const docs = [];
    const requestKeys = new Set();
    const duplicateRequestMap = new Map();
    for (const date of normalizedDates) {
      for (const shift of normalizedShifts) {
        const normalizedWindow =
          shift.shiftType && shift.shiftTag
            ? buildWindowFromShiftSlot({
                date,
                shiftType: shift.shiftType,
                shiftTag: shift.shiftTag,
                slotLookup,
                facilityTimezone,
              })
            : normalizeShiftWindow(shift.startTime, shift.endTime);

        if (normalizedWindow.error) {
          return res.status(400).json({
            message: normalizedWindow.error,
          });
        }

        const { startTime, endTime } = normalizedWindow;
        const uniqueKey = `${date.toISOString()}-${shift.role}-${shift.unitArea || ""}-${shift.shiftType || ""}-${shift.shiftTag || ""}-${startTime.toISOString()}-${endTime.toISOString()}`;
        const duplicateItem = formatDuplicateSchedule({
          date,
          role: shift.role,
          unitArea: shift.unitArea,
          shiftType: shift.shiftType,
          shiftTag: shift.shiftTag,
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
          shiftTag: shift.shiftTag || null,
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
        shiftTag: doc.shiftTag,
        startTime: doc.startTime,
        endTime: doc.endTime,
      })),
    })
      .select("date role unitArea shiftType shiftTag startTime endTime")
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
    if (req.query.shiftTag)
      filter.shiftTag = normalizeShiftTag(req.query.shiftTag);

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
    const { allowedRoles, allowedShiftTypes, slotLookup, facilityTimezone } =
      await getCoverageConfig(req.tenantId);

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

    if (update.shiftType !== undefined) {
      update.shiftType = normalizeShiftType(update.shiftType);
      if (
        update.shiftType &&
        allowedShiftTypes.size &&
        !allowedShiftTypes.has(update.shiftType)
      ) {
        return res.status(400).json({
          message: `invalid shiftType '${update.shiftType || ""}'`,
        });
      }
    }

    if (update.shiftTag !== undefined) {
      update.shiftTag = normalizeShiftTag(update.shiftTag) || null;
    }

    const existing = await Coverage.findOne({
      _id: id,
      tenantId: req.tenantId,
    });
    if (!existing)
      return res.status(404).json({ message: "Coverage not found" });

    const effectiveDate = update.date || existing.date;
    const effectiveShiftType =
      update.shiftType !== undefined
        ? normalizeShiftType(update.shiftType)
        : normalizeShiftType(existing.shiftType);
    const effectiveShiftTag =
      update.shiftTag !== undefined
        ? normalizeShiftTag(update.shiftTag)
        : normalizeShiftTag(existing.shiftTag);

    if (Boolean(effectiveShiftType) !== Boolean(effectiveShiftTag)) {
      return res.status(400).json({
        message: "shiftType and shiftTag must be provided together",
      });
    }

    if (effectiveShiftType && effectiveShiftTag) {
      const slotWindow = buildWindowFromShiftSlot({
        date: effectiveDate,
        shiftType: effectiveShiftType,
        shiftTag: effectiveShiftTag,
        slotLookup,
        facilityTimezone,
      });

      if (slotWindow.error) {
        return res.status(400).json({
          message: slotWindow.error,
        });
      }

      update.shiftType = effectiveShiftType;
      update.shiftTag = effectiveShiftTag;
      update.startTime = slotWindow.startTime;
      update.endTime = slotWindow.endTime;
    } else if (update.startTime !== undefined || update.endTime !== undefined) {
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
      if (update.shiftType === null || update.shiftType === "") {
        update.shiftTag = null;
      }
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
    const { role, unitArea, shiftType, shiftTag } = req.query;
    const tenantId = req.tenantId;

    if (!role) return res.status(400).json({ message: "role is required" });

    // 1. Get all coverages for this role
    const coveragesFilter = {
      tenantId,
      role,
    };
    if (unitArea) coveragesFilter.unitArea = normalizeAreaTag(unitArea);
    if (shiftType) coveragesFilter.shiftType = normalizeShiftType(shiftType);
    if (shiftTag) coveragesFilter.shiftTag = normalizeShiftTag(shiftTag);

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
      ...(shiftTag ? { shiftTag: normalizeShiftTag(shiftTag) } : {}),
      status: { $nin: ["completed", "call_out", "cancelled"] },
      $or: coverages.map((c) => ({
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    });

    // 3. Count how many staff are assigned per coverage
    const scheduleCountMap = {};

    schedules.forEach((s) => {
      const key = buildCoverageMatchKey(s);
      if (!scheduleCountMap[key]) scheduleCountMap[key] = 0;
      scheduleCountMap[key]++;
    });

    // 4. Build response
    const result = coverages.map((cov) => {
      const key = buildCoverageMatchKey(cov);
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
    const { role, unitArea, shiftType, shiftTag } = req.query; // optional
    const tenantId = req.tenantId;

    // 1. Get all coverages, optionally filtered by role
    const filter = { tenantId };
    if (role) filter.role = role;
    if (unitArea) filter.unitArea = normalizeAreaTag(unitArea);
    if (shiftType) filter.shiftType = normalizeShiftType(shiftType);
    if (shiftTag) filter.shiftTag = normalizeShiftTag(shiftTag);

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
    if (shiftTag) scheduleQuery.shiftTag = normalizeShiftTag(shiftTag);

    const schedules = await Schedule.find(scheduleQuery);

    // 3. Count how many staff are assigned per coverage.
    // Use a composite key that includes role so schedules for different roles
    // but the same times don't get mixed together when `role` query is absent.
    const scheduleCountMap = {};
    schedules.forEach((s) => {
      const key = buildCoverageMatchKey(s);
      if (!scheduleCountMap[key]) scheduleCountMap[key] = 0;
      scheduleCountMap[key]++;
    });

    // 4. Build response
    const result = coverages.map((cov) => {
      const key = buildCoverageMatchKey(cov);
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
