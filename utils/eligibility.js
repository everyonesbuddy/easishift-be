/**
 * Who can work which shift.
 *
 * Pure functions (moved unchanged from scheduleController) plus
 * eligibleStaffForCoverage, which also checks conflicts and time off.
 */
const User = require("../models/userModel");
const TimeOff = require("../models/timeOffModel");
const Schedule = require("../models/scheduleModel");
const {
  SYSTEM_ROLES,
  getSystemRoles,
  getUserRoles,
  normalizeRole,
} = require("../config/authorization");

const LEGACY_AREA_PREFIXES = ["al_", "il_", "mc_"];
const SCHEDULE_SYSTEM_ROLES = new Set(["user", "staff", "other"]);

const normalizeRoleFamily = (role) => {
  const value = String(role || "")
    .trim()
    .toLowerCase();

  if (!value) return "";

  for (const prefix of LEGACY_AREA_PREFIXES) {
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }

  return value;
};

const getStaffFacilityRoles = (staff, facilityConfig) => {
  const configuredRoles = new Set(
    (facilityConfig?.roleFamilies || []).map(normalizeRole),
  );
  const roles = getUserRoles(staff);
  const facilityRoles = roles.filter((role) => configuredRoles.has(role));

  if (facilityRoles.length) return facilityRoles;

  const legacyRole = normalizeRole(staff?.role);
  return legacyRole && !SYSTEM_ROLES.has(legacyRole) ? [legacyRole] : [];
};

const isStaffRoleCompatible = (staff, coverageRole, facilityConfig) =>
  getStaffFacilityRoles(staff, facilityConfig).some((role) =>
    isRoleCompatible(role, coverageRole),
  );

const getSchedulingCandidateTier = (staff, facilityConfig) => {
  const hasSystemRole = getSystemRoles(staff).length > 0;
  const hasFacilityRole =
    getStaffFacilityRoles(staff, facilityConfig).length > 0;

  if (!hasFacilityRole) return null;
  return hasSystemRole ? 2 : 1;
};

const isRoleCompatible = (staffRole, coverageRole) =>
  normalizeRoleFamily(staffRole) === normalizeRoleFamily(coverageRole);

const normalizeAreaTag = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeShiftType = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeShiftTag = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const inferShiftTypeFromWindow = (startTime, endTime) => {
  const start = new Date(startTime);
  const end = new Date(endTime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const startHour = start.getUTCHours();
  const crossesMidnight = end.getUTCDate() !== start.getUTCDate();

  if (crossesMidnight || startHour >= 23 || startHour < 7) {
    return "night";
  }

  if (startHour >= 15 && startHour < 23) {
    return "evening";
  }

  return "day";
};

const dedupeStrings = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

const getCoverageArea = (coverage) => normalizeAreaTag(coverage?.unitArea);

const getCoverageShiftType = (coverage) =>
  normalizeShiftType(coverage?.shiftType || coverage?.meta?.shiftType || "");

const getCoverageShiftTag = (coverage) =>
  normalizeShiftTag(coverage?.shiftTag || coverage?.meta?.shiftTag || "");

const getCoverageCertificationTags = (coverage) =>
  dedupeStrings(coverage?.requiredCertificationTags || []);

const getStaffExplicitAreas = (staff) =>
  dedupeStrings(staff?.allowedAreas).map(normalizeAreaTag);

const getStaffExplicitShiftTypes = (staff) =>
  dedupeStrings(staff?.allowedShiftTypes).map(normalizeShiftType);

const getStaffAllowedAreas = (staff, facilityAreas) => {
  const explicit = getStaffExplicitAreas(staff);
  if (explicit.length) return explicit;

  return dedupeStrings(facilityAreas).map(normalizeAreaTag);
};

const getStaffAllowedShiftTypes = (staff, facilityShiftTypes) => {
  const explicit = getStaffExplicitShiftTypes(staff);
  if (explicit.length) return explicit;

  return dedupeStrings(facilityShiftTypes).map(normalizeShiftType);
};

const getStaffCertificationTags = (staff) =>
  dedupeStrings(staff?.certificationTags);

const isCertificationCompatible = (requiredTags, staffTags) => {
  if (!requiredTags.length) return true;
  const staffTagSet = new Set(
    (staffTags || []).map((tag) => tag.toLowerCase()),
  );
  return requiredTags.every((tag) => staffTagSet.has(tag.toLowerCase()));
};

const isAreaCompatible = (staffAreas, coverageArea, hasAreaRestrictions) => {
  if (!staffAreas || !staffAreas.length) return true;
  if (!coverageArea) return !hasAreaRestrictions;
  return staffAreas.includes(coverageArea);
};

const isShiftTypeCompatible = (
  staffShiftTypes,
  coverageShiftType,
  coverageShiftTag,
  hasShiftTypeRestrictions,
) => {
  if (!staffShiftTypes || !staffShiftTypes.length) return true;

  const normalizedCoverageShiftType = normalizeShiftType(coverageShiftType);
  const normalizedCoverageShiftTag = normalizeShiftTag(coverageShiftTag);

  if (!normalizedCoverageShiftType) return !hasShiftTypeRestrictions;

  const compositeCoverageKey = normalizedCoverageShiftTag
    ? `${normalizedCoverageShiftType}:${normalizedCoverageShiftTag}`
    : null;

  return staffShiftTypes.some((value) => {
    const normalizedValue = normalizeShiftType(value);
    if (!normalizedValue) return false;

    // Supports both plain type allow-list (e.g. "day") and slot-level
    // allow-list (e.g. "day:day_1") stored in allowedShiftTypes.
    return (
      normalizedValue === normalizedCoverageShiftType ||
      (compositeCoverageKey && normalizedValue === compositeCoverageKey)
    );
  });
};

const getFacilityShiftTypes = (facilityPreferences) => {
  const configured = dedupeStrings(facilityPreferences?.shiftTypes).map(
    normalizeShiftType,
  );
  const defined = dedupeStrings(
    (facilityPreferences?.shiftTypeDefinitions || []).map((item) => item?.key),
  ).map(normalizeShiftType);
  const merged = dedupeStrings([...configured, ...defined]);
  return merged.length ? merged : ["day", "evening", "night"];
};

const getCompatibleFacilityConfig = (facilityPreferences) => ({
  roleFamilies: dedupeStrings(facilityPreferences?.roleFamilies).map(
    normalizeRoleFamily,
  ),
  areas: (facilityPreferences?.unitAreas || []).map(normalizeAreaTag),
  shiftTypes: getFacilityShiftTypes(facilityPreferences),
  certificationTags: dedupeStrings(facilityPreferences?.certificationTags),
});

const isEnabledScheduleRole = (role, facilityConfig) => {
  const normalized = normalizeRoleFamily(role);
  if (!normalized) return false;
  if (SCHEDULE_SYSTEM_ROLES.has(normalized)) return true;
  return (facilityConfig?.roleFamilies || []).includes(normalized);
};

const isStaffCompatibleWithCoverage = ({ staff, coverage, facilityConfig }) => {
  const explicitStaffAreas = getStaffExplicitAreas(staff);
  const explicitStaffShiftTypes = getStaffExplicitShiftTypes(staff);
  const staffAreas = getStaffAllowedAreas(staff, facilityConfig.areas);
  const staffShiftTypes = getStaffAllowedShiftTypes(
    staff,
    facilityConfig.shiftTypes,
  );
  const hasAreaRestrictions = explicitStaffAreas.length > 0;
  const hasShiftTypeRestrictions = explicitStaffShiftTypes.length > 0;
  const staffCerts = getStaffCertificationTags(staff);
  const coverageArea = getCoverageArea(coverage);
  const coverageShiftType = getCoverageShiftType(coverage);
  const coverageShiftTag = getCoverageShiftTag(coverage);
  const coverageCerts = getCoverageCertificationTags(coverage);

  return (
    isStaffRoleCompatible(staff, coverage.role, facilityConfig) &&
    isAreaCompatible(staffAreas, coverageArea, hasAreaRestrictions) &&
    isShiftTypeCompatible(
      staffShiftTypes,
      coverageShiftType,
      coverageShiftTag,
      hasShiftTypeRestrictions,
    ) &&
    isCertificationCompatible(coverageCerts, staffCerts)
  );
};


const minutesBetween = (start, end) =>
  Math.max(0, (new Date(end) - new Date(start)) / 60000);

/**
 * Everyone who could take `coverage`, with why the others can't.
 *
 * Returns [{ staff, eligible, reasons[], weekMinutes, overtimeIfAssigned }]
 * sorted eligible first, then fewest hours that week.
 *   reasons: "role" | "area" | "shift_type" | "certification" |
 *            "already_assigned" | "conflict" | "time_off"
 */
async function eligibleStaffForCoverage({
  tenantId,
  coverage,
  facilityConfig,
  weekStart,
  weekEnd,
  overtimeThresholdMinutes = 40 * 60,
  excludeStaffIds = [],
  staffList = null,
}) {
  const excluded = new Set(excludeStaffIds.map(String));
  const staff = (
    staffList ||
    (await User.find({ tenantId, loginEnabled: false, status: "active" })
      .select(
        "name role roles allowedAreas allowedShiftTypes certificationTags phoneE164 email smsConsent",
      )
      .lean())
  ).filter((person) => !excluded.has(String(person._id)));
  if (!staff.length) return [];

  const staffIds = staff.map((person) => person._id);
  const [overlapping, timeOff, weekSchedules] = await Promise.all([
    Schedule.find({
      tenantId,
      staffId: { $in: staffIds },
      status: { $nin: ["completed", "call_out", "no_show"] },
      startTime: { $lt: coverage.endTime },
      endTime: { $gt: coverage.startTime },
    })
      .select("staffId coverageId")
      .lean(),
    TimeOff.find({
      tenantId,
      staffId: { $in: staffIds },
      status: "approved",
      startTime: { $lt: coverage.endTime },
      endTime: { $gt: coverage.startTime },
    })
      .select("staffId")
      .lean(),
    weekStart && weekEnd
      ? Schedule.find({
          tenantId,
          staffId: { $in: staffIds },
          status: { $nin: ["call_out", "no_show"] },
          startTime: { $gte: weekStart, $lt: weekEnd },
        })
          .select("staffId startTime endTime")
          .lean()
      : [],
  ]);

  const assignedHere = new Set();
  const conflicted = new Set();
  for (const row of overlapping) {
    if (row.coverageId && String(row.coverageId) === String(coverage._id)) {
      assignedHere.add(String(row.staffId));
    } else {
      conflicted.add(String(row.staffId));
    }
  }
  const onTimeOff = new Set(timeOff.map((row) => String(row.staffId)));
  const minutesByStaff = new Map();
  for (const row of weekSchedules) {
    const key = String(row.staffId);
    minutesByStaff.set(
      key,
      (minutesByStaff.get(key) || 0) + minutesBetween(row.startTime, row.endTime),
    );
  }
  const shiftMinutes = minutesBetween(coverage.startTime, coverage.endTime);

  const results = staff.map((person) => {
    const key = String(person._id);
    const reasons = [];
    const explicitAreas = getStaffExplicitAreas(person);
    const explicitShiftTypes = getStaffExplicitShiftTypes(person);

    if (!isStaffRoleCompatible(person, coverage.role, facilityConfig)) {
      reasons.push("role");
    }
    if (
      !isAreaCompatible(
        getStaffAllowedAreas(person, facilityConfig.areas),
        getCoverageArea(coverage),
        explicitAreas.length > 0,
      )
    ) {
      reasons.push("area");
    }
    if (
      !isShiftTypeCompatible(
        getStaffAllowedShiftTypes(person, facilityConfig.shiftTypes),
        getCoverageShiftType(coverage),
        getCoverageShiftTag(coverage),
        explicitShiftTypes.length > 0,
      )
    ) {
      reasons.push("shift_type");
    }
    if (
      !isCertificationCompatible(
        getCoverageCertificationTags(coverage),
        getStaffCertificationTags(person),
      )
    ) {
      reasons.push("certification");
    }
    if (assignedHere.has(key)) reasons.push("already_assigned");
    if (conflicted.has(key)) reasons.push("conflict");
    if (onTimeOff.has(key)) reasons.push("time_off");

    const weekMinutes = minutesByStaff.get(key) || 0;
    return {
      staff: person,
      eligible: reasons.length === 0,
      reasons,
      weekMinutes,
      overtimeIfAssigned:
        weekMinutes + shiftMinutes > overtimeThresholdMinutes,
    };
  });

  return results.sort(
    (a, b) =>
      Number(b.eligible) - Number(a.eligible) ||
      Number(a.overtimeIfAssigned) - Number(b.overtimeIfAssigned) ||
      a.weekMinutes - b.weekMinutes ||
      String(a.staff.name).localeCompare(String(b.staff.name)),
  );
}

module.exports = {
  normalizeRoleFamily,
  getStaffFacilityRoles,
  isStaffRoleCompatible,
  getSchedulingCandidateTier,
  isRoleCompatible,
  normalizeAreaTag,
  normalizeShiftType,
  normalizeShiftTag,
  inferShiftTypeFromWindow,
  dedupeStrings,
  getCoverageArea,
  getCoverageShiftType,
  getCoverageShiftTag,
  getCoverageCertificationTags,
  getStaffExplicitAreas,
  getStaffExplicitShiftTypes,
  getStaffAllowedAreas,
  getStaffAllowedShiftTypes,
  getStaffCertificationTags,
  isCertificationCompatible,
  isAreaCompatible,
  isShiftTypeCompatible,
  getFacilityShiftTypes,
  getCompatibleFacilityConfig,
  isEnabledScheduleRole,
  isStaffCompatibleWithCoverage,
  eligibleStaffForCoverage,
};
