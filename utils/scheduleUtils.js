// utils/scheduleUtils.js
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
    // ignore completed or cancelled schedules when checking conflicts
    status: { $nin: ["completed", "cancelled"] },
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

module.exports = { hasConflict };
