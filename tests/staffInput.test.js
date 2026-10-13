const test = require("node:test");
const assert = require("node:assert/strict");

const {
  _normalizeStaffInput: normalize,
  _mapCsvRecord: mapCsv,
  _normalizeRoleKey: roleKey,
} = require("../controllers/staffController");
const { _getMemberRole: memberRole } = require("../controllers/memberController");

const roles = new Set(["cna", "med_tech", "rn"]);

test("normalizes a staff contact", () => {
  const { value, error } = normalize(
    { name: " Maria Lopez ", phone: "(555) 123-4567", email: "Maria@X.com", role: "Med Tech" },
    roles,
  );
  assert.equal(error, undefined);
  assert.equal(value.name, "Maria Lopez");
  assert.equal(value.email, "maria@x.com");
  assert.deepEqual(value.roles, ["med_tech"]);
  assert.equal(value.role, "med_tech");
});

test("rejects workspace roles, unknown roles and bad contacts", () => {
  assert.match(normalize({ name: "A", phone: "5551234567", role: "owner" }, roles).error, /workspace role/);
  assert.match(normalize({ name: "A", phone: "5551234567", role: "admin" }, roles).error, /workspace role/);
  assert.match(normalize({ name: "A", phone: "5551234567", role: "chef" }, roles).error, /Unknown role/);
  assert.match(normalize({ name: "A", email: "nope", role: "cna" }, roles).error, /Invalid email/);
  assert.match(normalize({ name: "", phone: "5551234567", role: "cna" }, roles).error, /Name/);
});

test("partial updates only touch provided fields", () => {
  const { value } = normalize({ notes: "Nights only" }, roles, { partial: true });
  assert.deepEqual(value, { notes: "Nights only" });
});

test("maps common CSV headers", () => {
  assert.deepEqual(
    mapCsv({ "Full Name": "Kim Tran", Mobile: "5551112222", "E-mail": "kim@x.com", Position: "CNA" }),
    { name: "Kim Tran", phone: "5551112222", email: "kim@x.com", role: "CNA" },
  );
  assert.equal(roleKey("Care Partner"), "care_partner");
});

test("reads one workspace role per account", () => {
  assert.equal(memberRole({ roles: ["owner"] }), "owner");
  assert.equal(memberRole({ roles: ["admin"] }), "scheduler");
  assert.equal(memberRole({ roles: ["viewer"] }), "viewer");
  assert.equal(memberRole({ roles: ["cna"] }), null);
});
