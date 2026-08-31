const test = require("node:test");
const assert = require("node:assert/strict");

const { PREFERENCE_WEIGHTS, getRotationPenalty, getPreferencePenalty } =
  require("../controllers/scheduleController")._scoring;

// 2026-09-07 is a Monday; 2026-09-12 is the Saturday of that same week.
const MONDAY_WEEK_0 = new Date("2026-09-07T14:00:00.000Z");
const SATURDAY_WEEK_0 = new Date("2026-09-12T14:00:00.000Z");
const MONDAY_WEEK_1 = new Date("2026-09-14T14:00:00.000Z");
const SATURDAY_WEEK_1 = new Date("2026-09-19T14:00:00.000Z");
const MONDAY_WEEK_2 = new Date("2026-09-21T14:00:00.000Z");

const anchor = MONDAY_WEEK_0;

test("every other week penalizes off-weeks and repeats every 2 weeks", () => {
  const prefs = {
    worksEveryOtherWeek: true,
    rotationAnchorDate: anchor,
  };

  assert.equal(
    getRotationPenalty({
      staffPreferences: prefs,
      coverageStart: MONDAY_WEEK_0,
    }),
    0,
  );
  assert.equal(
    getRotationPenalty({
      staffPreferences: prefs,
      coverageStart: MONDAY_WEEK_1,
    }),
    PREFERENCE_WEIGHTS.rotationOffWeek,
  );
  assert.equal(
    getRotationPenalty({
      staffPreferences: prefs,
      coverageStart: MONDAY_WEEK_2,
    }),
    0,
  );
});

test("every other week parity works for dates before the anchor", () => {
  const prefs = {
    worksEveryOtherWeek: true,
    rotationAnchorDate: MONDAY_WEEK_2,
  };

  assert.equal(
    getRotationPenalty({
      staffPreferences: prefs,
      coverageStart: MONDAY_WEEK_1,
    }),
    PREFERENCE_WEIGHTS.rotationOffWeek,
  );
  assert.equal(
    getRotationPenalty({
      staffPreferences: prefs,
      coverageStart: MONDAY_WEEK_0,
    }),
    0,
  );
});

test("every-other-week preference is ignored when no anchor is set", () => {
  const prefs = {
    worksEveryOtherWeek: true,
    rotationAnchorDate: null,
  };

  assert.equal(
    getRotationPenalty({
      staffPreferences: prefs,
      coverageStart: MONDAY_WEEK_1,
    }),
    0,
  );
});

test("a staff member without the preference has no rotation penalty", () => {
  assert.equal(
    getRotationPenalty({
      staffPreferences: { worksEveryOtherWeek: false },
      coverageStart: MONDAY_WEEK_1,
    }),
    0,
  );
});

test("no preferences means no penalty", () => {
  assert.equal(
    getPreferencePenalty({
      staffPreferences: null,
      coverage: { startTime: MONDAY_WEEK_0 },
    }),
    0,
  );
});

test("avoided day costs more than a merely non-preferred day", () => {
  const base = {
    coverage: { startTime: MONDAY_WEEK_0 },
    projectedWeekMinutes: 0,
    projectedAssignedDaysThisWeek: 1,
    consecutiveDaysIfAssigned: 1,
    overtimeMinutes: 0,
  };

  const nonPreferred = getPreferencePenalty({
    ...base,
    staffPreferences: { preferredDaysOfWeek: [0, 6], wantsOvertime: true },
  });
  const avoided = getPreferencePenalty({
    ...base,
    staffPreferences: { avoidDaysOfWeek: [1], wantsOvertime: true },
  });

  assert.equal(nonPreferred, PREFERENCE_WEIGHTS.nonPreferredDay);
  assert.equal(avoided, PREFERENCE_WEIGHTS.avoidedDay);
  assert.ok(avoided > nonPreferred);
});

test("exceeding max consecutive days scales with the overage", () => {
  const staffPreferences = { maxConsecutiveDays: 3, wantsOvertime: true };
  const base = {
    staffPreferences,
    coverage: { startTime: MONDAY_WEEK_0 },
    projectedWeekMinutes: 0,
    projectedAssignedDaysThisWeek: 1,
    overtimeMinutes: 0,
  };

  assert.equal(
    getPreferencePenalty({ ...base, consecutiveDaysIfAssigned: 3 }),
    0,
  );
  assert.equal(
    getPreferencePenalty({ ...base, consecutiveDaysIfAssigned: 5 }),
    PREFERENCE_WEIGHTS.overMaxConsecutiveDays * 2,
  );
});

test("target hours penalize only the hours above target", () => {
  const base = {
    staffPreferences: { targetHoursPerWeek: 20, wantsOvertime: true },
    coverage: { startTime: MONDAY_WEEK_0 },
    projectedAssignedDaysThisWeek: 1,
    consecutiveDaysIfAssigned: 1,
    overtimeMinutes: 0,
  };

  assert.equal(
    getPreferencePenalty({ ...base, projectedWeekMinutes: 20 * 60 }),
    0,
  );
  assert.equal(
    getPreferencePenalty({ ...base, projectedWeekMinutes: 24 * 60 }),
    PREFERENCE_WEIGHTS.perHourOverTarget * 4,
  );
});

test("wantsOvertime removes the overtime penalty", () => {
  const base = {
    coverage: { startTime: MONDAY_WEEK_0 },
    projectedWeekMinutes: 0,
    projectedAssignedDaysThisWeek: 1,
    consecutiveDaysIfAssigned: 1,
    overtimeMinutes: 120,
  };

  assert.equal(
    getPreferencePenalty({
      ...base,
      staffPreferences: { wantsOvertime: false },
    }),
    PREFERENCE_WEIGHTS.unwantedOvertime,
  );
  assert.equal(
    getPreferencePenalty({
      ...base,
      staffPreferences: { wantsOvertime: true },
    }),
    0,
  );
});
