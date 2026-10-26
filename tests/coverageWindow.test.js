const test = require("node:test");
const assert = require("node:assert/strict");
const Coverage = require("../models/coverageModel");
const ctrl = require("../controllers/coverageController");

// Captures the filter each list endpoint sends to Mongo.
function stubFind() {
  const seen = {};
  const original = Coverage.find;
  Coverage.find = (filter) => {
    seen.filter = filter;
    const chain = { sort: () => chain, lean: async () => [] };
    return chain;
  };
  return { seen, restore: () => { Coverage.find = original; } };
}
const run = async (handler, query) => {
  let body;
  const res = { json: (b) => { body = b; }, status: () => res };
  await handler({ tenantId: "t1", query }, res, (err) => { throw err; });
  return body;
};

test("open spots (unfilled-auto): skips spots that are over by default", async () => {
  const { seen, restore } = stubFind();
  try {
    const before = Date.now();
    assert.deepEqual(await run(ctrl.getUnfilledCoverageForAuto, {}), []);
    assert.ok(seen.filter.endTime.$gte.getTime() >= before);
    await run(ctrl.getUnfilledCoverageForAuto, { includePast: "true" });
    assert.equal(seen.filter.endTime, undefined);
    await run(ctrl.getUnfilledCoverageForAuto, { from: "2026-11-01T00:00:00Z", to: "2026-11-08T00:00:00Z", role: "cna" });
    assert.equal(seen.filter.endTime.$gte.toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(seen.filter.startTime.$lte.toISOString(), "2026-11-08T00:00:00.000Z");
    assert.equal(seen.filter.role, "cna");
  } finally {
    restore();
  }
});

test("coverage list: no window means everything (unchanged); ?from=&to= narrows; bad dates ignored", async () => {
  const { seen, restore } = stubFind();
  try {
    await run(ctrl.getCoverage, {});
    assert.deepEqual(seen.filter, { tenantId: "t1" });
    await run(ctrl.getCoverage, { from: "2026-11-01", to: "nope" });
    assert.ok(seen.filter.endTime.$gte instanceof Date);
    assert.equal(seen.filter.startTime, undefined);
  } finally {
    restore();
  }
});

test("responses are gzip-compressed", () => {
  const src = require("node:fs").readFileSync(require.resolve("../app.js"), "utf8");
  assert.match(src, /app\.use\(compression\(\)\)/);
});
