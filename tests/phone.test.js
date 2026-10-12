const test = require("node:test");
const assert = require("node:assert/strict");
const { buildE164Number } = require("../utils/phone");

test("normalizes phone numbers to E.164", () => {
  assert.equal(buildE164Number("+1", "(555) 123-4567"), "+15551234567");
  assert.equal(buildE164Number("1", "555.123.4567"), "+15551234567");
  assert.equal(buildE164Number(null, "+44 7700 900123"), "+447700900123");
  assert.equal(buildE164Number("+234", "08033501686"), "+2348033501686");
  assert.equal(buildE164Number("+1", "15551234567"), "+15551234567");
  assert.equal(buildE164Number(undefined, "5551234567"), "+15551234567");
});

test("rejects empty or impossible numbers", () => {
  assert.equal(buildE164Number("+1", ""), null);
  assert.equal(buildE164Number("+1", null), null);
  assert.equal(buildE164Number("+1", "12"), null);
});
