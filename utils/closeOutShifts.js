/**
 * Closes out shifts that have ended (runs every 2 hours from app.js).
 *
 * - Time tracking on: a sent shift nobody clocked in to becomes "no_show",
 *   but only once the shift end + the facility's clock-out grace has passed.
 * - Time tracking off: a sent shift that has ended becomes "completed".
 * - Shifts never sent ("Not sent yet") are left alone: the person was never
 *   told about them, so they're not a no-show.
 * - In-progress shifts that have ended become "completed", and clock-ins
 *   still open after their shift ended are clocked out.
 */
const FacilityPreferences = require("../models/facilityPreferencesModel");
const Schedule = require("../models/scheduleModel");
const TimeEntry = require("../models/timeEntryModel");
const { getAttendanceOutcomeForClockOut } = require("./timeTrackingAttendanceUtils");

const DEFAULT_GRACE_MINUTES = 30;
const count = (result) =>
  result?.modifiedCount !== undefined ? result.modifiedCount : result?.nModified || 0;

async function closeOutPastShifts(now = new Date()) {
  const [scheduledPast, facilityPrefs] = await Promise.all([
    Schedule.find({ status: "scheduled", endTime: { $lt: now }, state: { $ne: "draft" } })
      .select("tenantId endTime")
      .lean(),
    FacilityPreferences.find({})
      .select("tenantId timeTracking.enabled timeTracking.clockOutGraceMinutes")
      .lean(),
  ]);

  const graceByTenant = new Map(
    facilityPrefs
      .filter((prefs) => prefs?.timeTracking?.enabled)
      .map((prefs) => {
        const grace = Number(prefs?.timeTracking?.clockOutGraceMinutes);
        return [String(prefs.tenantId), Number.isFinite(grace) && grace >= 0 ? grace : DEFAULT_GRACE_MINUTES];
      }),
  );

  const noShowIds = [];
  const completedIds = [];
  for (const shift of scheduledPast) {
    const grace = graceByTenant.get(String(shift.tenantId));
    if (grace === undefined) {
      completedIds.push(shift._id);
    } else if (new Date(shift.endTime).getTime() + grace * 60000 <= now.getTime()) {
      noShowIds.push(shift._id);
    }
    // else: still inside the grace period; checked again next run.
  }

  const noShowResult = noShowIds.length
    ? await Schedule.updateMany(
        { _id: { $in: noShowIds }, status: "scheduled" },
        { $set: { status: "no_show", "meta.noShowAt": now } },
      )
    : null;
  const completedResult = completedIds.length
    ? await Schedule.updateMany(
        { _id: { $in: completedIds }, status: "scheduled" },
        { $set: { status: "completed", "meta.completedAt": now } },
      )
    : null;
  const inProgressResult = await Schedule.updateMany(
    { status: "in_progress", endTime: { $lt: now } },
    { $set: { status: "completed", "meta.completedAt": now } },
  );

  // Clock-ins still open after their shift ended: clock them out.
  const overdue = await TimeEntry.find({
    tenantId: { $in: [...graceByTenant.keys()] },
    status: "in_progress",
    clockInAt: { $lte: now },
  })
    .select("_id tenantId scheduleId")
    .lean();
  if (overdue.length) {
    const shifts = await Schedule.find({ _id: { $in: overdue.map((e) => e.scheduleId).filter(Boolean) } })
      .select("_id endTime")
      .lean();
    const byId = new Map(shifts.map((s) => [String(s._id), s]));
    const ops = overdue
      .filter((entry) => {
        const shift = entry.scheduleId && byId.get(String(entry.scheduleId));
        return shift?.endTime && new Date(shift.endTime).getTime() <= now.getTime();
      })
      .map((entry) => ({
        updateOne: {
          filter: { _id: entry._id, status: "in_progress" },
          update: {
            $set: {
              clockOutAt: now,
              status: "completed",
              attendanceOutcome: getAttendanceOutcomeForClockOut({
                scheduledEndTime: byId.get(String(entry.scheduleId)).endTime,
                clockOutAt: now,
                clockOutGraceMinutes: graceByTenant.get(String(entry.tenantId)),
              }),
            },
          },
        },
      }));
    if (ops.length) await TimeEntry.bulkWrite(ops);
  }

  return { noShow: count(noShowResult), completed: count(completedResult) + count(inProgressResult) };
}

module.exports = { closeOutPastShifts };
