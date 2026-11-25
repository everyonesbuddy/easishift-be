const test = require("node:test");
const assert = require("node:assert/strict");
const { shortShift, shortWeek, firstName, staffConfirmText, prettyNumber } = require("../utils/notify");

test("formats shifts and weeks for texts", () => {
  assert.equal(
    shortShift("2026-10-16T19:00:00Z", "2026-10-17T03:00:00Z", "America/New_York"),
    "Fri Oct 16, 3p–11p",
  );
  assert.equal(
    shortShift("2026-10-16T11:30:00Z", "2026-10-16T19:30:00Z", "America/New_York"),
    "Fri Oct 16, 7:30a–3:30p",
  );
  assert.equal(shortWeek("2026-10-11"), "Oct 11–17");
  assert.equal(shortWeek("2026-10-26"), "Oct 26–Nov 1");
  assert.equal(firstName("  Kim  Tran "), "Kim");
});

test("the confirmation after opting in names the facility, frequency, rates and how to stop", () => {
  const text = staffConfirmText("Sunrise Care", "https://wisershifts.com/s/abc");
  assert.match(text, /subscribed to WiserShifts schedule texts from Sunrise Care/);
  assert.match(text, /frequency varies/);
  assert.match(text, /data rates may apply/);
  assert.match(text, /STOP/);
  assert.match(text, /HELP/);
  assert.equal(prettyNumber("+18554498584"), "(855) 449-8584");
});
