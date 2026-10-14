const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSection, inSection } = require("../utils/sections");

test("no roles or areas means the whole week", () => {
  assert.equal(parseSection({}), null);
  assert.equal(inSection({ role: "concierge", unitArea: "assisted_living" }, null), true);
});

test("section by role, area, or both", () => {
  const byRole = parseSection({ roles: ["Concierge"] });
  assert.equal(inSection({ role: "concierge", unitArea: "assisted_living" }, byRole), true);
  assert.equal(inSection({ role: "cook" }, byRole), false);

  const byArea = parseSection({ areas: ["Assisted Living"] });
  assert.equal(inSection({ role: "cook", unitArea: "assisted living" }, byArea), true);
  assert.equal(inSection({ role: "cook", unitArea: null }, byArea), false);

  const both = parseSection({ roles: ["concierge"], areas: ["assisted_living"] });
  assert.equal(inSection({ role: "concierge", unitArea: "assisted_living" }, both), true);
  assert.equal(inSection({ role: "concierge", unitArea: "independent_living" }, both), false);
});
