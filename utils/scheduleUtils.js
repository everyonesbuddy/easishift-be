// utils/scheduleUtils.js
const mongoose = require("mongoose");
const Schedule = require("../models/scheduleModel");

/**
 * Check for overlaps for staff (returns boolean and optionally conflicts)
 * startTime/endTime should be Date objects or ISO strings.
 */
async function hasConflict({
  tenantId,
  staffId,
  startTime,
  endTime,
  excludeScheduleId,
}) {
  const filter = {
    tenantId,
    staffId,
    // ignore completed schedules when checking conflicts
    status: { $nin: ["completed"] },
    $or: [
      // existing starts before new end AND existing ends after new start => overlap
      {
        startTime: { $lt: new Date(endTime) },
        endTime: { $gt: new Date(startTime) },
      },
    ],
  };

  if (excludeScheduleId) filter._id = { $ne: excludeScheduleId };

  const conflict = await Schedule.findOne(filter).lean();
  return conflict; // null if none, document if conflict
}

// Statuses that still occupy a coverage slot. Terminal/abandoned states free it.
const COVERAGE_OCCUPYING_STATUSES = [
  "scheduled",
  "in_progress",
  "completed",
  "left_early",
];

/**
 * Count filled slots per coverage in one indexed aggregation.
 * Returns a Map of coverageId string -> assigned count.
 */
async function countAssignmentsByCoverage({
  tenantId,
  coverageIds,
  statuses = COVERAGE_OCCUPYING_STATUSES,
}) {
  // aggregate() skips Mongoose casting, so ids must be real ObjectIds here.
  const ids = (coverageIds || [])
    .filter((id) => id && mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

  if (!ids.length) return new Map();
  if (!mongoose.isValidObjectId(tenantId)) return new Map();

  const rows = await Schedule.aggregate([
    {
      $match: {
        tenantId: new mongoose.Types.ObjectId(String(tenantId)),
        coverageId: { $in: ids },
        status: { $in: statuses },
      },
    },
    { $group: { _id: "$coverageId", assignedCount: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [row._id.toString(), row.assignedCount]));
}

module.exports = {
  hasConflict,
  countAssignmentsByCoverage,
  COVERAGE_OCCUPYING_STATUSES,
};
