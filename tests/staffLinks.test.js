const test = require("node:test");
const assert = require("node:assert/strict");

process.env.STAFF_LINK_KEY = "b".repeat(64);
const links = require("../utils/staffLinks");

test("tokens round-trip through encryption", () => {
  const token = "abc123_-XYZ";
  const enc = links.encrypt(token);
  assert.notEqual(enc, token);
  assert.equal(links.decrypt(enc), token);
  // Same token encrypts differently each time (random IV).
  assert.notEqual(links.encrypt(token), enc);
});

test("tampered ciphertext is rejected", () => {
  const enc = links.encrypt("token");
  const [iv, tag, data] = enc.split(":");
  const flipped = Buffer.from(data, "base64");
  flipped[0] ^= 1;
  assert.throws(() => links.decrypt([iv, tag, flipped.toString("base64")].join(":")));
});

test("hash is stable and not the token", () => {
  assert.equal(links.hashToken("x"), links.hashToken("x"));
  assert.notEqual(links.hashToken("x"), "x");
});

test("a missing or short key is refused", () => {
  const saved = process.env.STAFF_LINK_KEY;
  process.env.STAFF_LINK_KEY = "short";
  assert.throws(() => links.assertStaffLinkKey(), /STAFF_LINK_KEY/);
  process.env.STAFF_LINK_KEY = saved;
});
