const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeViewFilters } = require("../utils/viewFilters");

test("cleans roles and areas to tag keys, drops blanks and repeats", () => {
  const out = normalizeViewFilters({ schedule: { roles: ["Med Tech", "med_tech", " CNA "], areas: ["Memory Care", ""] } });
  assert.deepEqual(out, { schedule: { roles: ["med_tech", "cna"], areas: ["memory_care"] } });
});

test("only the kinds sent are returned", () => {
  assert.deepEqual(normalizeViewFilters({ needs: {} }), { needs: { roles: [], areas: [] } });
  assert.deepEqual(normalizeViewFilters({}), {});
});

test("rejects bad shapes", () => {
  assert.throws(() => normalizeViewFilters(null), /must be an object/);
  assert.throws(() => normalizeViewFilters({ other: {} }), /Unknown view filter/);
  assert.throws(() => normalizeViewFilters({ schedule: { roles: "cna" } }), /must be a list/);
  assert.throws(() => normalizeViewFilters({ schedule: { roles: [1] } }), /list of text/);
  assert.throws(() => normalizeViewFilters({ schedule: { roles: Array.from({ length: 51 }, (_, i) => `r${i}`) } }), /at most 50/);
  assert.throws(() => normalizeViewFilters({ schedule: { areas: ["x".repeat(61)] } }), /60 characters/);
});
