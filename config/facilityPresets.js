/**
 * Facility-type presets used at onboarding.
 *
 * Picking a type fills in the facility's roles and shift times and gives the
 * staffing template sensible starting numbers. The scheduler edits all of it
 * on the next two screens.
 *
 * countsByWeekday is 7 numbers, Sunday = 0 ... Saturday = 6.
 */

// [Mon–Fri, Sat–Sun] -> [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
const weekdaysWeekends = (weekday, weekend) => [
  weekend,
  weekday,
  weekday,
  weekday,
  weekday,
  weekday,
  weekend,
];

const slot = (tag, startLocalTime, endLocalTime, label) => ({
  tag,
  label,
  startLocalTime,
  endLocalTime,
  spansOvernight: endLocalTime <= startLocalTime,
});

const EIGHT_HOUR_SHIFTS = [
  { key: "day", label: "Day", timeSlots: [slot("day_1", "07:00", "15:00", "Day 7a–3p")] },
  { key: "evening", label: "Evening", timeSlots: [slot("evening_1", "15:00", "23:00", "Evening 3p–11p")] },
  { key: "night", label: "Night", timeSlots: [slot("night_1", "23:00", "07:00", "Night 11p–7a")] },
];

const rule = (shiftType, shiftTag, role, weekday, weekend) => ({
  shiftType,
  shiftTag,
  role,
  unitArea: null,
  requiredCertificationTags: [],
  countsByWeekday: weekdaysWeekends(weekday, weekend),
});

const PRESETS = Object.freeze({
  assisted_living: {
    label: "Assisted living",
    roleFamilies: ["caregiver", "med_tech", "lpn"],
    shiftTypeDefinitions: EIGHT_HOUR_SHIFTS,
    templateRules: [
      rule("day", "day_1", "caregiver", 3, 2),
      rule("day", "day_1", "med_tech", 1, 1),
      rule("evening", "evening_1", "caregiver", 2, 2),
      rule("evening", "evening_1", "med_tech", 1, 1),
      rule("night", "night_1", "caregiver", 2, 2),
    ],
  },
  memory_care: {
    label: "Memory care",
    roleFamilies: ["caregiver", "med_tech", "lpn"],
    shiftTypeDefinitions: EIGHT_HOUR_SHIFTS,
    templateRules: [
      rule("day", "day_1", "caregiver", 3, 3),
      rule("day", "day_1", "med_tech", 1, 1),
      rule("evening", "evening_1", "caregiver", 3, 2),
      rule("evening", "evening_1", "med_tech", 1, 1),
      rule("night", "night_1", "caregiver", 2, 2),
    ],
  },
  skilled_nursing: {
    label: "Skilled nursing",
    roleFamilies: ["cna", "lpn", "rn"],
    shiftTypeDefinitions: EIGHT_HOUR_SHIFTS,
    templateRules: [
      rule("day", "day_1", "cna", 6, 5),
      rule("day", "day_1", "lpn", 2, 2),
      rule("day", "day_1", "rn", 1, 1),
      rule("evening", "evening_1", "cna", 5, 4),
      rule("evening", "evening_1", "lpn", 2, 2),
      rule("evening", "evening_1", "rn", 1, 1),
      rule("night", "night_1", "cna", 3, 3),
      rule("night", "night_1", "lpn", 1, 1),
      rule("night", "night_1", "rn", 1, 1),
    ],
  },
  home_care: {
    label: "Home care",
    roleFamilies: ["caregiver"],
    shiftTypeDefinitions: [
      { key: "day", label: "Day", timeSlots: [slot("day_1", "08:00", "16:00", "Day 8a–4p")] },
      { key: "night", label: "Overnight", timeSlots: [slot("night_1", "20:00", "08:00", "Overnight 8p–8a")] },
    ],
    templateRules: [
      rule("day", "day_1", "caregiver", 2, 1),
      rule("night", "night_1", "caregiver", 1, 1),
    ],
  },
  other: {
    label: "Other",
    roleFamilies: [],
    shiftTypeDefinitions: EIGHT_HOUR_SHIFTS,
    templateRules: [],
  },
});

const FACILITY_TYPES = Object.keys(PRESETS);

/** The FacilityPreferences fields a preset sets. */
const getPresetPreferences = (facilityType) => {
  const preset = PRESETS[facilityType];
  if (!preset) return null;
  return {
    roleFamilies: [...preset.roleFamilies],
    unitAreas: [],
    shiftTypes: preset.shiftTypeDefinitions.map((def) => def.key),
    shiftTypeDefinitions: preset.shiftTypeDefinitions.map((def) => ({
      ...def,
      timeSlots: def.timeSlots.map((s) => ({ ...s })),
    })),
  };
};

const getPresetTemplateRules = (facilityType) =>
  (PRESETS[facilityType]?.templateRules || []).map((r) => ({
    ...r,
    countsByWeekday: [...r.countsByWeekday],
  }));

module.exports = {
  PRESETS,
  FACILITY_TYPES,
  getPresetPreferences,
  getPresetTemplateRules,
  weekdaysWeekends,
};
