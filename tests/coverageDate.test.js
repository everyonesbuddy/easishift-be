const test = require("node:test");
const assert = require("node:assert/strict");

const { _normalizeToUTC } = require("../controllers/coverageController");

test("keeps the calendar day written in date strings", () => {
  const expected = "2026-10-11T00:00:00.000Z";
  assert.equal(_normalizeToUTC("2026-10-11").toISOString(), expected);
  // Local midnight east of UTC used to land on the previous day.
  assert.equal(
    _normalizeToUTC("2026-10-11T00:00:00+01:00").toISOString(),
    expected,
  );
  assert.equal(
    _normalizeToUTC("2026-10-11T00:00:00-04:00").toISOString(),
    expected,
  );
});

test("uses the UTC day for Date objects", () => {
  assert.equal(
    _normalizeToUTC(new Date("2026-10-11T23:30:00.000Z")).toISOString(),
    "2026-10-11T00:00:00.000Z",
  );
});
