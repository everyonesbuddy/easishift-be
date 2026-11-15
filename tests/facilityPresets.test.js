const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FACILITY_TYPES,
  getPresetPreferences,
  getPresetTemplateRules,
  weekdaysWeekends,
} = require("../config/facilityPresets");

test("weekday/weekend counts are Sunday-first", () => {
  assert.deepEqual(weekdaysWeekends(3, 2), [2, 3, 3, 3, 3, 3, 2]);
});

test("every template rule points at a real shift slot and role", () => {
  for (const type of FACILITY_TYPES) {
    const prefs = getPresetPreferences(type);
    const slots = new Set(
      prefs.shiftTypeDefinitions.flatMap((def) =>
        def.timeSlots.map((slot) => `${def.key}:${slot.tag}`),
      ),
    );
    for (const rule of getPresetTemplateRules(type)) {
      assert.ok(slots.has(`${rule.shiftType}:${rule.shiftTag}`), `${type} ${rule.shiftTag}`);
      assert.ok(prefs.roleFamilies.includes(rule.role), `${type} ${rule.role}`);
      assert.equal(rule.countsByWeekday.length, 7);
    }
  }
});

test("overnight slots are flagged", () => {
  const night = getPresetPreferences("skilled_nursing").shiftTypeDefinitions.find(
    (def) => def.key === "night",
  );
  assert.equal(night.timeSlots[0].spansOvernight, true);
  assert.equal(getPresetTemplateRules("skilled_nursing").length, 9);
});

test("presets are copies, not shared objects", () => {
  const a = getPresetTemplateRules("assisted_living");
  a[0].countsByWeekday[0] = 99;
  assert.notEqual(getPresetTemplateRules("assisted_living")[0].countsByWeekday[0], 99);
});

test("presets: other 24/7 care teams (group homes, behavioral health, hospice houses)", () => {
  for (const type of ["group_home", "behavioral_health", "hospice_house"]) {
    assert.ok(FACILITY_TYPES.includes(type), type);
    const prefs = getPresetPreferences(type);
    assert.ok(prefs.roleFamilies.length >= 2, `${type} has roles`);
    // Every rule's role is one of the preset's roles, and every shift it uses exists.
    const shifts = new Set(prefs.shiftTypeDefinitions.map((d) => d.key));
    for (const r of getPresetTemplateRules(type)) {
      assert.ok(prefs.roleFamilies.includes(r.role), `${type}: ${r.role}`);
      assert.ok(shifts.has(r.shiftType), `${type}: ${r.shiftType}`);
    }
  }
  const Tenant = require("../models/tenantModel");
  const allowed = Tenant.schema.path("facilityType").enumValues;
  for (const type of FACILITY_TYPES) assert.ok(allowed.includes(type), `tenant accepts ${type}`);
});
