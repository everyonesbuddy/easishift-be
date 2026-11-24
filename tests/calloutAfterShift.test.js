const test = require("node:test");
const assert = require("node:assert/strict");

process.env.STAFF_LINK_KEY = process.env.STAFF_LINK_KEY || "c".repeat(64);
const Schedule = require("../models/scheduleModel");
const TimeEntry = require("../models/timeEntryModel");
const ctrl = require("../controllers/calloutController");

const ID = "64b7f0c2a1b2c3d4e5f60718";
const hours = (h) => new Date(Date.now() + h * 3600e3);

/** Run a handler with a fake shift; returns { status, body, shift }. */
async function run(handler, shift, { clockedIn = false } = {}) {
  const orig = [Schedule.findOne, TimeEntry.exists];
  const doc = { _id: ID, tenantId: "t1", meta: {}, ...shift, save: async () => {}, markModified: () => {} };
  Schedule.findOne = async () => doc;
  TimeEntry.exists = async () => (clockedIn ? { _id: "te" } : null);
  let status = 200;
  let body;
  const res = { status: (c) => ((status = c), res), json: (b) => ((body = b), res) };
  try {
    await handler({ params: { id: ID }, tenantId: "t1", body: { reason: "sick" } }, res, (err) => {
      throw err;
    });
  } finally {
    [Schedule.findOne, TimeEntry.exists] = orig;
  }
  return { status, body, shift: doc };
}

test("after the shift: a no-show the scheduler forgot to mark becomes a call-out, and can be undone", async () => {
  const r = await run(ctrl.markCallOut, { status: "no_show", startTime: hours(-30), endTime: hours(-22) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.afterShift, true);
  assert.deepEqual(r.body.candidates, [], "the shift is over: nobody to find");
  assert.equal(r.shift.status, "call_out");
  assert.equal(r.shift.meta.statusBeforeCallOut, "no_show");
  assert.equal(r.shift.meta.calloutMarkedAfterShift, true);

  const u = await run(ctrl.undoCallOut, { status: "call_out", startTime: hours(-30), endTime: hours(-22), meta: { statusBeforeCallOut: "no_show", calloutMarkedAfterShift: true } });
  assert.equal(u.status, 200, JSON.stringify(u.body));
  assert.equal(u.shift.status, "no_show", "back to how it was closed out");
  assert.equal(u.shift.meta.calloutMarkedAfterShift, undefined);
});

test("after the shift: completed with time tracking off is fine; a clock-in, a left-early or 30+ days old is not", async () => {
  const done = await run(ctrl.markCallOut, { status: "completed", startTime: hours(-10), endTime: hours(-2) });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.shift.status, "call_out");

  const clocked = await run(ctrl.markCallOut, { status: "completed", startTime: hours(-10), endTime: hours(-2) }, { clockedIn: true });
  assert.equal(clocked.status, 400);
  assert.match(clocked.body.message, /clocked in/);

  const left = await run(ctrl.markCallOut, { status: "left_early", startTime: hours(-10), endTime: hours(-2) });
  assert.equal(left.status, 400);

  const old = await run(ctrl.markCallOut, { status: "no_show", startTime: hours(-24 * 32), endTime: hours(-24 * 31.7) });
  assert.equal(old.status, 400);
  assert.match(old.body.message, /30 days/);
});

test("undo only for after-the-fact call-outs (before a shift, a replacement may already be on it)", async () => {
  const r = await run(ctrl.undoCallOut, { status: "call_out", startTime: hours(5), endTime: hours(13), meta: { statusBeforeCallOut: "scheduled" } });
  assert.equal(r.status, 400);
  assert.equal(r.shift.status, "call_out", "unchanged");
});
