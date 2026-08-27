const test = require("node:test");
const assert = require("node:assert/strict");
const { DateTime } = require("luxon");
const {
  parseCoverageCopyRequest,
  buildCoverageCopyDraft,
} = require("../config/nlFormParsers");

test("detects copy coverage from last week to this week request", () => {
  const parsed = parseCoverageCopyRequest(
    "copy coverage from last week to this week",
  );
  assert.equal(parsed?.kind, "coverage-copy");
  assert.equal(parsed?.period, "week");
  assert.equal(parsed?.source, "last week");
  assert.equal(parsed?.target, "this week");
});

test("detects copy coverage from october to november request", () => {
  const parsed = parseCoverageCopyRequest(
    "copy coverage from october to november",
  );
  assert.equal(parsed?.kind, "coverage-copy");
  assert.equal(parsed?.period, "month-range");
  assert.equal(parsed?.sourceMonth, "october");
  assert.equal(parsed?.targetMonth, "november");
});

test("detects copy coverage from 2026-10-01 to 2026-10-31 request", () => {
  const parsed = parseCoverageCopyRequest(
    "copy coverage from 2026-10-01 to 2026-10-31",
  );
  assert.equal(parsed?.kind, "coverage-copy");
  assert.equal(parsed?.period, "date-range");
  assert.equal(parsed?.sourceDate, "2026-10-01");
  assert.equal(parsed?.targetDate, "2026-10-31");
});

test("rejects copy requests without an explicit from/to range", () => {
  const parsed = parseCoverageCopyRequest("copy coverage last week");
  assert.equal(parsed, null);
});

test("builds a repeat draft from prior coverage history", () => {
  const context = {
    facilityTimezone: "UTC",
    roleFamilies: ["rn"],
    unitAreas: ["icu"],
    certificationTags: ["bcls"],
    shiftSlotsByType: {
      day: [{ tag: "day", startLocalTime: "07:00", endLocalTime: "15:00" }],
    },
  };

  const history = [
    {
      role: "rn",
      unitArea: "ICU",
      shiftType: "day",
      shiftTag: "day",
      requiredCount: 2,
      requiredCertificationTags: ["BCLS"],
      startTime: "2026-08-24T07:00:00.000Z",
      endTime: "2026-08-24T15:00:00.000Z",
      date: "2026-08-24T00:00:00.000Z",
    },
    {
      role: "rn",
      unitArea: "ICU",
      shiftType: "day",
      shiftTag: "day",
      requiredCount: 2,
      requiredCertificationTags: ["BCLS"],
      startTime: "2026-08-25T07:00:00.000Z",
      endTime: "2026-08-25T15:00:00.000Z",
      date: "2026-08-25T00:00:00.000Z",
    },
  ];

  const draft = buildCoverageCopyDraft(
    "copy coverage from last week",
    context,
    history,
  );

  assert.ok(draft);
  assert.ok(Array.isArray(draft.shifts));
  assert.ok(draft.shifts.length >= 1);
  assert.ok(draft.datePattern);
  assert.equal(draft.datePattern.horizonDays, 7);
  assert.ok(
    ["custom", "weekdays", "daily"].includes(draft.datePattern.repeatMode),
  );
  assert.ok(draft.datePattern.startDate);
  assert.ok(DateTime.fromISO(draft.datePattern.startDate).isValid);
});
