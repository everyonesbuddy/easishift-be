const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseBrandingUpdate,
  sanitizeFromName,
  wrapBrandedEmail,
} = require("../utils/tenantBranding");

test("parses partial branding updates", () => {
  const { set, errors } = parseBrandingUpdate({
    primaryColor: "#1A2B3C",
    secondaryColor: null,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(set, {
    "branding.primaryColor": "#1a2b3c",
    "branding.secondaryColor": null,
  });

  const invalid = parseBrandingUpdate({
    primaryColor: "red",
    displayName: "x".repeat(81),
  });
  assert.equal(invalid.errors.length, 2);
});

test("sanitizes email from names and escapes branded layout", () => {
  assert.equal(sanitizeFromName('Evil"\r\nBcc: <x@y.z>'), "EvilBcc: x@y.z");

  const html = wrapBrandedEmail(
    { displayName: "<b>ABC</b>", primaryColor: "red;x", logoUrl: null },
    "<p>Hi</p>",
  );
  assert.ok(html.includes("&lt;b&gt;ABC&lt;/b&gt;"));
  assert.ok(!html.includes("red;x"));
  assert.ok(html.includes("<p>Hi</p>"));
});
