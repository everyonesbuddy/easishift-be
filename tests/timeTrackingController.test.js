const test = require("node:test");
const assert = require("node:assert/strict");

const controller = require("../controllers/timeTrackingController");

test("hashQrToken returns a stable hash for the same token", () => {
  const token = "facility-qr-token";
  assert.equal(controller.hashQrToken(token), controller.hashQrToken(token));
  assert.match(controller.hashQrToken(token), /^[a-f0-9]{64}$/);
});

test("generateQrTokenValue returns a non-empty token string", () => {
  const token = controller.generateQrTokenValue();
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);
});
