const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("../utils/hq/history");

const now = new Date("2026-11-06T19:00:00Z"); // Friday, 2 p.m. in New York
const day = (d) => d.toISOString();

test("history: periods are Monday weeks and calendar months in New York time", () => {
  const lw = h.rangeFor("last_week", { now });
  assert.equal(day(lw.start), "2026-10-26T04:00:00.000Z");
  assert.equal(day(lw.end), "2026-11-02T05:00:00.000Z", "the clocks changed on Nov 1");
  assert.equal(lw.days, 7);
  assert.equal(lw.span, "Oct 26 to Nov 1, 2026");

  const l4 = h.rangeFor("last_4_weeks", { now });
  assert.equal(day(l4.start), "2026-10-12T04:00:00.000Z");
  assert.equal(day(l4.end), "2026-11-09T05:00:00.000Z", "includes this week");

  const lm = h.rangeFor("last_month", { now });
  assert.equal(day(lm.start), "2026-10-01T04:00:00.000Z");
  assert.equal(day(lm.end), "2026-11-01T04:00:00.000Z");
  assert.equal(lm.days, 31);

  const tm = h.rangeFor("this_month", { now });
  assert.equal(day(tm.start), "2026-11-01T04:00:00.000Z");

  const c = h.rangeFor("custom", { from: "2026-10-05", to: "2026-10-09", now });
  assert.equal(c.label, "Oct 5 to Oct 9");
  assert.equal(c.days, 5);
  assert.equal(h.rangeFor("nonsense", { now }).key, "this_week");
});

test("history: targets scale with the period; outcomes are tallied, most first", () => {
  assert.equal(h.targetFor({ weeklyTarget: 60 }, 7), 60);
  assert.equal(h.targetFor({ weeklyTarget: 60 }, 31), 266);
  assert.equal(h.targetFor({ weeklyTarget: 0.5 }, 7), 1, "every two weeks still shows 1 for a week");
  assert.equal(h.targetFor({ weeklyTarget: 0.5 }, 28), 2);
  assert.equal(h.targetFor({ weeklyTarget: 0 }, 28), 0);
  assert.deepEqual(h.tally(["Talked", "Left a voicemail", "Left a voicemail", "", "Booked the setup"]), [["Left a voicemail", 2], ["Talked", 1], ["Booked the setup", 1]]);
});
