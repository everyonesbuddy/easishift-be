const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PREFERENCE_WEIGHTS,
  getWeekdayIndex,
  getDayKey,
  getWeekStart,
  isWeekendDate,
  isNightShift,
  getPreferencePenalty,
  getRotationPenalty,
} = require("../controllers/scheduleController")._scoring;

const NY = "America/New_York";

// Monday 2026-08-31 21:00 EDT is Tuesday 01:00 UTC — the case that was
// previously misclassified by the UTC-only helpers.
const MON_NIGHT_LOCAL = new Date("2026-09-01T01:00:00.000Z");
// Monday 2026-08-31 07:00 EDT stays Monday in UTC.
const MON_DAY_LOCAL = new Date("2026-08-31T11:00:00.000Z");
// Sunday 2026-09-06 21:00 EDT is Monday 01:00 UTC.
const SUN_NIGHT_LOCAL = new Date("2026-09-07T01:00:00.000Z");

test("night shift keeps its local weekday", () => {
  assert.equal(getWeekdayIndex(MON_NIGHT_LOCAL, NY), 1); // Monday locally
  assert.equal(getWeekdayIndex(MON_NIGHT_LOCAL, "UTC"), 2); // Tuesday in UTC
});

test("day shift is unaffected by zone", () => {
  assert.equal(getWeekdayIndex(MON_DAY_LOCAL, NY), 1);
  assert.equal(getWeekdayIndex(MON_DAY_LOCAL, "UTC"), 1);
});

test("day key follows the local calendar day", () => {
  assert.equal(getDayKey(MON_NIGHT_LOCAL, NY), "2026-08-31");
  assert.equal(getDayKey(MON_NIGHT_LOCAL, "UTC"), "2026-09-01");
});

test("Sunday night belongs to the local week, not the next UTC week", () => {
  const localWeek = getWeekStart(SUN_NIGHT_LOCAL, NY);
  const utcWeek = getWeekStart(SUN_NIGHT_LOCAL, "UTC");
  assert.notEqual(localWeek.getTime(), utcWeek.getTime());
  // Local week starts Sunday 2026-09-06 00:00 EDT = 04:00 UTC.
  assert.equal(localWeek.toISOString(), "2026-09-06T04:00:00.000Z");
});

test("Sunday night counts as a weekend locally but not in UTC", () => {
  assert.equal(isWeekendDate(SUN_NIGHT_LOCAL, NY), true);
  assert.equal(isWeekendDate(SUN_NIGHT_LOCAL, "UTC"), false);
});

test("a 09:00 Tokyo day shift is not a night shift", () => {
  // 2026-09-01 09:00 in Tokyo is 00:00 UTC, which UTC-only logic called night.
  const start = new Date("2026-09-01T00:00:00.000Z");
  const end = new Date("2026-09-01T08:00:00.000Z");

  assert.equal(isNightShift(start, end, "Asia/Tokyo"), false);
  assert.equal(isNightShift(start, end, "UTC"), true);
});

test("preferring Monday is honoured for a Monday night shift", () => {
  const base = {
    staffPreferences: { preferredDaysOfWeek: [1], wantsOvertime: true },
    coverage: { startTime: MON_NIGHT_LOCAL },
    projectedWeekMinutes: 0,
    projectedAssignedDaysThisWeek: 1,
    consecutiveDaysIfAssigned: 1,
    overtimeMinutes: 0,
  };

  assert.equal(getPreferencePenalty({ ...base, timezone: NY }), 0);
  assert.equal(
    getPreferencePenalty({ ...base, timezone: "UTC" }),
    PREFERENCE_WEIGHTS.nonPreferredDay,
  );
});

test("biweekly parity for a Sunday night follows the local week", () => {
  const staffPreferences = {
    worksEveryOtherWeek: true,
    rotationAnchorDate: new Date("2026-09-06T04:00:00.000Z"),
  };

  assert.equal(
    getRotationPenalty({
      staffPreferences,
      coverageStart: SUN_NIGHT_LOCAL,
      timezone: NY,
    }),
    0,
  );
});

test("an unset timezone falls back to UTC behaviour", () => {
  assert.equal(getWeekdayIndex(MON_NIGHT_LOCAL, undefined), 2);
  assert.equal(getWeekdayIndex(MON_NIGHT_LOCAL, "Junk/Zone"), 2);
});
