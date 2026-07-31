const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getAttendanceOutcomeForClockOut,
} = require("../utils/timeTrackingAttendanceUtils");

test("returns left_early when clock out happens before the grace cutoff", () => {
  const scheduledEndTime = new Date("2026-01-01T10:00:00.000Z");
  const clockOutAt = new Date("2026-01-01T09:20:00.000Z");

  const outcome = getAttendanceOutcomeForClockOut({
    scheduledEndTime,
    clockOutAt,
    clockOutGraceMinutes: 30,
  });

  assert.equal(outcome, "left_early");
});

test("returns completed when clock out happens after the grace cutoff", () => {
  const scheduledEndTime = new Date("2026-01-01T10:00:00.000Z");
  const clockOutAt = new Date("2026-01-01T09:45:00.000Z");

  const outcome = getAttendanceOutcomeForClockOut({
    scheduledEndTime,
    clockOutAt,
    clockOutGraceMinutes: 30,
  });

  assert.equal(outcome, "completed");
});

test("returns completed when there is no schedule end time", () => {
  const outcome = getAttendanceOutcomeForClockOut({
    scheduledEndTime: null,
    clockOutAt: new Date("2026-01-01T09:45:00.000Z"),
    clockOutGraceMinutes: 30,
  });

  assert.equal(outcome, "completed");
});
