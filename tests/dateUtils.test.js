const test = require("node:test");
const assert = require("node:assert/strict");
const d = require("../utils/dateUtils");

test("week start in the facility's zone", () => {
  // Tue 02:00 UTC is still Monday evening in New York.
  assert.equal(d.weekStartFor(new Date("2026-10-13T02:00:00Z"), "America/New_York", 0), "2026-10-11");
  assert.equal(d.weekStartFor(new Date("2026-10-13T02:00:00Z"), "America/New_York", 1), "2026-10-12");
  // Saturday 23:30 in Lagos is Saturday; Sunday-start week began the 11th.
  assert.equal(d.weekStartFor(new Date("2026-10-17T22:30:00Z"), "Africa/Lagos", 0), "2026-10-11");
});

test("week days and bounds", () => {
  assert.deepEqual(d.weekDays("2026-10-11"), [
    "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17",
  ]);
  const { start, end } = d.weekBounds("2026-10-11", "America/New_York");
  assert.equal(start.toISOString(), "2026-10-11T04:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-18T04:00:00.000Z");
  assert.equal(d.weekdayOfKey("2026-10-11"), 0);
  assert.equal(d.isDateKey("2026-02-30"), false);
  assert.equal(d.isDateKey("2026-10-11"), true);
});

test("shift slots become real instants, overnight ends next day", () => {
  const lookup = d.buildShiftSlotLookup({
    shiftTypeDefinitions: [
      { key: "night", timeSlots: [{ tag: "night_1", startLocalTime: "23:00", endLocalTime: "07:00", spansOvernight: true }] },
    ],
  });
  const w = d.buildWindowFromShiftSlot({
    date: d.dateKeyToCoverageDate("2026-10-11"),
    shiftType: "night",
    shiftTag: "night_1",
    slotLookup: lookup,
    facilityTimezone: "America/New_York",
  });
  assert.equal(w.startTime.toISOString(), "2026-10-12T03:00:00.000Z");
  assert.equal(w.endTime.toISOString(), "2026-10-12T11:00:00.000Z");
});

test("findShiftSlotForWindow matches custom hours to a shift time", () => {
  const { buildShiftSlotLookup, buildWindowFromShiftSlot, findShiftSlotForWindow } = require("../utils/dateUtils");
  const prefs = {
    shiftTypeDefinitions: [
      { key: "day", timeSlots: [{ tag: "day_1", startLocalTime: "07:00", endLocalTime: "15:00" }] },
      { key: "night", timeSlots: [{ tag: "night_1", startLocalTime: "23:00", endLocalTime: "07:00", spansOvernight: true }] },
    ],
  };
  const slotLookup = buildShiftSlotLookup(prefs);
  const tz = "America/New_York";
  const date = new Date("2026-10-18T00:00:00Z");
  const night = buildWindowFromShiftSlot({ date, shiftType: "night", shiftTag: "night_1", slotLookup, facilityTimezone: tz });
  assert.deepEqual(
    findShiftSlotForWindow({ date, startTime: night.startTime, endTime: night.endTime, slotLookup, facilityTimezone: tz }),
    { shiftType: "night", shiftTag: "night_1" },
  );
  const nineToFive = { startTime: new Date("2026-10-18T13:00:00Z"), endTime: new Date("2026-10-18T21:00:00Z") };
  assert.equal(findShiftSlotForWindow({ date, ...nineToFive, slotLookup, facilityTimezone: tz }), null);
});
