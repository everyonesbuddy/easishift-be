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
