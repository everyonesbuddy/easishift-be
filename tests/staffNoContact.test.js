const test = require("node:test");
const assert = require("node:assert/strict");

// Staff can be added with a name and role only (no phone, no email).
test("staff without a phone or email can be added, one by one and by import", async () => {
  const stub = (rel, exports) => {
    const p = require.resolve(rel);
    const saved = require.cache[p];
    require.cache[p] = { id: p, filename: p, loaded: true, exports: { ...require(rel), ...exports } };
    return () => { if (saved) require.cache[p] = saved; else delete require.cache[p]; };
  };
  let links = 0;
  const restore = [
    stub("../utils/staffLinks", { createStaffLink: async () => { links += 1; } }),
    stub("../utils/planLimits", { assertLimit: async () => {} }),
  ];
  const ctrlPath = require.resolve("../controllers/staffController");
  delete require.cache[ctrlPath];
  const User = require("../models/userModel");
  const FacilityPreferences = require("../models/facilityPreferencesModel");
  const orig = { create: User.create, findOne: User.findOne, prefs: FacilityPreferences.findOne };
  const created = [];
  FacilityPreferences.findOne = () => ({ select: () => ({ lean: async () => ({ roleFamilies: ["cna"] }) }) });
  User.findOne = () => ({ select: () => ({ lean: async () => null }) });
  User.create = async (doc) => {
    const saved = { _id: `id${created.length + 1}`, ...doc };
    created.push(saved);
    return saved;
  };
  try {
    const ctrl = require(ctrlPath);
    const one = await ctrl.createStaffContact({ tenantId: "t1" }, { name: "Rosa Diaz", roles: ["cna"] });
    assert.equal(one.status, 201);
    assert.equal(one.body.hasContact, false);
    assert.equal(created[0].email ?? null, null);
    assert.equal(links, 1, "they still get a personal link");

    let body;
    const res = { status: () => res, json: (b) => { body = b; } };
    await ctrl.bulkCreateStaff(
      { tenantId: "t1", body: { rows: [{ name: "Ann Lee", role: "cna" }, { name: "Bo Kim", role: "cna", email: "bo@x.com" }] } },
      res,
      (err) => { throw err; },
    );
    const statuses = (body.results || []).map((r) => r.status);
    assert.ok(!statuses.includes("failed_validation"), JSON.stringify(body));
    assert.equal(created.length, 3);
  } finally {
    User.create = orig.create;
    User.findOne = orig.findOne;
    FacilityPreferences.findOne = orig.prefs;
    restore.forEach((r) => r());
    delete require.cache[ctrlPath];
  }
});
