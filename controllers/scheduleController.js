// controllers/scheduleController.js
const Schedule = require("../models/scheduleModel");
const { buildE164Number } = require("../utils/phone");
const { findSchedulers } = require("../utils/schedulers");
const {
  sendToStaff,
  notifySchedulers,
  shortShift,
  firstName,
  escapeHtml,
} = require("../utils/notify");
const { getStaffLinkUrl } = require("../utils/staffLinks");
const {
  markPendingChange,
  stateForNewSchedule,
  getWeekSettings,
} = require("../utils/weekService");
const { getEffectivePlanKey } = require("../config/plans");
const ScheduleWeek = require("../models/scheduleWeekModel");
const Tenant = require("../models/tenantModel");
const {
  weekStartFor,
  dateKeyToCoverageDate,
  addDaysToKey,
} = require("../utils/dateUtils");
const {
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
} = require("../utils/eligibility");

const Coverage = require("../models/coverageModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const Preferences = require("../models/preferencesModel");
const TimeOff = require("../models/timeOffModel");
const User = require("../models/userModel");
const ShiftSwap = require("../models/shiftSwapModel");
const AutoScheduleDraft = require("../models/autoScheduleDraftModel");
const {
  hasConflict,
  countAssignmentsByCoverage,
  COVERAGE_OCCUPYING_STATUSES,
} = require("../utils/scheduleUtils");
const { markOfferFilledIfAny } = require("../utils/callouts");
const {
  formatRangeInFacilityZone,
  formatInFacilityZone,
  normalizeZone,
} = require("../utils/timezoneUtils");
const { DateTime } = require("luxon");
const { sendEmail } = require("../utils/sendEmail");
const { sendSMS } = require("../utils/sendSMS");
const mongoose = require("mongoose");
const {
  SYSTEM_ROLES,
  getSystemRoles,
  getUserRoles,
  hasPermission,
  normalizeRole,
} = require("../config/authorization");

const HOURS_TO_MINUTES = 60;
const PICKUP_ACTIVE_STATUSES = ["scheduled", "in_progress"];
const SELF_SERVICE_SCHEDULE_STATUSES = new Set(["scheduled", "call_out"]);

const DEFAULT_FACILITY_POLICY = Object.freeze({
  schedulingPattern: "balance",
  weeklyOvertimeThresholdHours: 40,
  fairnessLookbackDays: 28,
  shiftReminderLeadHours: 24,
  notifyStaffOnCoveragePost: false,
});

const minutesBetween = (start, end) =>
  (new Date(end) - new Date(start)) / 60000;

// Scheduling instants are stored in UTC; calendar questions ("which day?",
// "is this a weekend?") must be answered in the facility's local zone.
const toZoned = (dateLike, timezone) =>
  DateTime.fromJSDate(new Date(dateLike)).setZone(normalizeZone(timezone));

const addDays = (dateLike, days, timezone) =>
  toZoned(dateLike, timezone).startOf("day").plus({ days }).toJSDate();

const getDayKey = (dateLike, timezone) =>
  toZoned(dateLike, timezone).toFormat("yyyy-MM-dd");

// 0 = Sunday ... 6 = Saturday, matching the stored preference format.
const getWeekdayIndex = (dateLike, timezone) =>
  toZoned(dateLike, timezone).weekday % 7;

// Weeks start on Sunday.
const getWeekStart = (dateLike, timezone) => {
  const zoned = toZoned(dateLike, timezone).startOf("day");
  return zoned.minus({ days: zoned.weekday % 7 }).toJSDate();
};

const buildWeekKey = (staffId, dateLike, timezone) =>
  `${staffId.toString()}|${getWeekStart(dateLike, timezone).toISOString()}`;

const stableHash = (value) => {
  const text = String(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const getEffectiveFacilityPolicy = (facilityPreferences) => {
  const merged = {
    ...DEFAULT_FACILITY_POLICY,
    ...(facilityPreferences || {}),
  };

  return {
    ...merged,
    weeklyOvertimeThresholdMinutes:
      Number(merged.weeklyOvertimeThresholdHours) * HOURS_TO_MINUTES,
  };
};

const isWeekendDate = (dateLike, timezone) => {
  const weekday = getWeekdayIndex(dateLike, timezone);
  return weekday === 0 || weekday === 6;
};

const isNightShift = (startTime, endTime, timezone) => {
  const start = toZoned(startTime, timezone);
  const end = toZoned(endTime, timezone);
  return !start.hasSame(end, "day") || start.hour >= 19 || start.hour < 6;
};

const parseTimeToMinutes = (value) => {
  if (!value || typeof value !== "string") return null;
  const [hoursText, minutesText] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return hours * HOURS_TO_MINUTES + minutes;
};

const getUtcMinutesOfDay = (dateLike) => {
  const date = new Date(dateLike);
  return date.getUTCHours() * HOURS_TO_MINUTES + date.getUTCMinutes();
};

const getEffectiveOvertimeThresholdMinutes = ({ facilityPolicy }) => {
  return facilityPolicy.weeklyOvertimeThresholdMinutes;
};

const getConsecutiveDaysIfAssigned = (assignedDaySet, dateLike, timezone) => {
  const dayKeys = new Set(assignedDaySet || []);
  const targetDate = addDays(dateLike, 0, timezone);
  dayKeys.add(getDayKey(targetDate, timezone));

  let total = 1;
  let cursor = addDays(targetDate, -1, timezone);
  while (dayKeys.has(getDayKey(cursor, timezone))) {
    total += 1;
    cursor = addDays(cursor, -1, timezone);
  }

  cursor = addDays(targetDate, 1, timezone);
  while (dayKeys.has(getDayKey(cursor, timezone))) {
    total += 1;
    cursor = addDays(cursor, 1, timezone);
  }

  return total;
};

const countAssignedDaysInWeekIfAssigned = (
  assignedDaySet,
  dateLike,
  timezone,
) => {
  const dayKeys = new Set(assignedDaySet || []);
  dayKeys.add(getDayKey(dateLike, timezone));

  let total = 0;
  const weekStart = getWeekStart(dateLike, timezone);
  for (let offset = 0; offset < 7; offset += 1) {
    if (
      dayKeys.has(getDayKey(addDays(weekStart, offset, timezone), timezone))
    ) {
      total += 1;
    }
  }

  return total;
};

const getPatternPenalty = ({
  schedulingPattern,
  coverageStart,
  assignedDaySet,
  consecutiveDaysIfAssigned,
  projectedAssignedDaysThisWeek,
  timezone,
}) => {
  const previousDayAssigned = assignedDaySet?.has(
    getDayKey(addDays(coverageStart, -1, timezone), timezone),
  );
  const nextDayAssigned = assignedDaySet?.has(
    getDayKey(addDays(coverageStart, 1, timezone), timezone),
  );
  const isWeekend = isWeekendDate(coverageStart, timezone);

  switch (schedulingPattern) {
    case "balance":
    case "custom":
      return 0;
    case "4_on_4_off":
      if (consecutiveDaysIfAssigned > 4) return 4;
      return previousDayAssigned || nextDayAssigned ? 0 : 2;
    case "2_2_3":
      if (consecutiveDaysIfAssigned > 3) return 3;
      if (consecutiveDaysIfAssigned === 1) return 2;
      return 0;
    case "panama":
      if (consecutiveDaysIfAssigned > 3) return 3;
      if (projectedAssignedDaysThisWeek > 4) return 2;
      if (consecutiveDaysIfAssigned === 1) return 2;
      return 0;
    case "fixed_5_2":
      if (isWeekend) return 4;
      if (projectedAssignedDaysThisWeek > 5) return 3;
      return 0;
    case "rotating_3":
      if (projectedAssignedDaysThisWeek > 3) return 4;
      if (previousDayAssigned || nextDayAssigned) return 2;
      return 0;
    default:
      return 0;
  }
};

const addTrackedSchedule = ({
  schedule,
  trackedKeys,
  staffAssignedDaySets,
  weekendShiftCounts,
  nightShiftCounts,
  timezone,
}) => {
  if (!schedule || schedule.status === "call_out") return;

  const staffId = schedule.staffId.toString();
  const key = `${staffId}|${new Date(schedule.startTime).toISOString()}|${new Date(schedule.endTime).toISOString()}`;

  if (trackedKeys.has(key)) return;
  trackedKeys.add(key);

  if (!staffAssignedDaySets[staffId]) {
    staffAssignedDaySets[staffId] = new Set();
  }
  staffAssignedDaySets[staffId].add(getDayKey(schedule.startTime, timezone));

  if (isWeekendDate(schedule.startTime, timezone)) {
    weekendShiftCounts[staffId] = (weekendShiftCounts[staffId] || 0) + 1;
  }

  if (isNightShift(schedule.startTime, schedule.endTime, timezone)) {
    nightShiftCounts[staffId] = (nightShiftCounts[staffId] || 0) + 1;
  }
};

// Relative cost of violating each soft preference. Tuned so a single hard-ish
// violation (avoided day, off-week rotation) outweighs a mild one.
const PREFERENCE_WEIGHTS = Object.freeze({
  nonPreferredDay: 2,
  avoidedDay: 4,
  overMaxConsecutiveDays: 5,
  overMaxShiftsPerWeek: 5,
  perHourOverTarget: 1,
  unwantedOvertime: 4,
  rotationOffWeek: 5,
});

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

const getRotationPenalty = ({ staffPreferences, coverageStart, timezone }) => {
  if (!staffPreferences?.worksEveryOtherWeek) return 0;

  const anchor = staffPreferences.rotationAnchorDate;
  if (!anchor) return 0;

  const anchorWeek = getWeekStart(anchor, timezone);
  const shiftWeek = getWeekStart(coverageStart, timezone);
  const weeksApart = Math.round((shiftWeek - anchorWeek) / MS_PER_WEEK);

  return Math.abs(weeksApart % 2) === 1
    ? PREFERENCE_WEIGHTS.rotationOffWeek
    : 0;
};

const getPreferencePenalty = ({
  staffPreferences,
  coverage,
  coverageMinutes,
  projectedWeekMinutes,
  projectedAssignedDaysThisWeek,
  consecutiveDaysIfAssigned,
  overtimeMinutes,
  timezone,
}) => {
  if (!staffPreferences) return 0;

  let penalty = 0;
  const coverageStart = coverage.startTime || coverage.date;
  const weekday = getWeekdayIndex(coverageStart, timezone);

  const preferredDays = staffPreferences.preferredDaysOfWeek;
  if (
    Array.isArray(preferredDays) &&
    preferredDays.length > 0 &&
    !preferredDays.includes(weekday)
  ) {
    penalty += PREFERENCE_WEIGHTS.nonPreferredDay;
  }

  if ((staffPreferences.avoidDaysOfWeek || []).includes(weekday)) {
    penalty += PREFERENCE_WEIGHTS.avoidedDay;
  }

  const { maxConsecutiveDays, maxShiftsPerWeek, targetHoursPerWeek } =
    staffPreferences;

  if (maxConsecutiveDays && consecutiveDaysIfAssigned > maxConsecutiveDays) {
    penalty +=
      PREFERENCE_WEIGHTS.overMaxConsecutiveDays *
      (consecutiveDaysIfAssigned - maxConsecutiveDays);
  }

  if (maxShiftsPerWeek && projectedAssignedDaysThisWeek > maxShiftsPerWeek) {
    penalty +=
      PREFERENCE_WEIGHTS.overMaxShiftsPerWeek *
      (projectedAssignedDaysThisWeek - maxShiftsPerWeek);
  }

  // Only over-target is penalized; being under target is already favoured by
  // the projectedWeekMinutes sort key.
  if (targetHoursPerWeek) {
    const targetMinutes = targetHoursPerWeek * HOURS_TO_MINUTES;
    const overMinutes = Math.max(0, projectedWeekMinutes - targetMinutes);
    if (overMinutes > 0) {
      penalty +=
        PREFERENCE_WEIGHTS.perHourOverTarget * (overMinutes / HOURS_TO_MINUTES);
    }
  }

  if (!staffPreferences.wantsOvertime && overtimeMinutes > 0) {
    penalty += PREFERENCE_WEIGHTS.unwantedOvertime;
  }

  penalty += getRotationPenalty({
    staffPreferences,
    coverageStart,
    timezone,
  });

  return Math.round(penalty * 100) / 100;
};

const getTagSpecificityScore = ({ staff, coverage }) => {
  const coverageArea = getCoverageArea(coverage);
  const coverageShiftType = getCoverageShiftType(coverage);
  const coverageShiftTag = getCoverageShiftTag(coverage);

  const explicitAreas = getStaffExplicitAreas(staff);
  const explicitShiftTypes = getStaffExplicitShiftTypes(staff);

  const hasExplicitAreaRestrictions = explicitAreas.length > 0;
  const hasExplicitShiftRestrictions = explicitShiftTypes.length > 0;

  const explicitShiftMatch =
    hasExplicitShiftRestrictions &&
    !!coverageShiftType &&
    explicitShiftTypes.some((value) => {
      const normalizedValue = normalizeShiftType(value);
      if (!normalizedValue) return false;

      const compositeCoverageKey = coverageShiftTag
        ? `${coverageShiftType}:${coverageShiftTag}`
        : null;

      return (
        normalizedValue === coverageShiftType ||
        (compositeCoverageKey && normalizedValue === compositeCoverageKey)
      );
    });

  let score = 0;

  // Prefer explicitly-tagged staff that match the current tagged coverage.
  if (coverageArea && hasExplicitAreaRestrictions) {
    score += explicitAreas.includes(coverageArea) ? 2 : -2;
  }

  // Shift slot/type tag match gets higher precedence than area.
  if (coverageShiftType && hasExplicitShiftRestrictions) {
    score += explicitShiftMatch ? 3 : -3;
  }

  return score;
};

const buildRankingMetrics = ({
  staff,
  staffId,
  coverage,
  coverageMinutes,
  coverageId,
  facilityPolicy,
  facilityConfig,
  staffPreferences,
  weeklyWorkload,
  recentWorkload,
  weekendShiftCounts,
  nightShiftCounts,
  staffAssignedDaySets,
  timezone,
}) => {
  const weekKey = buildWeekKey(staffId, coverage.startTime, timezone);
  const projectedWeekMinutes = (weeklyWorkload[weekKey] || 0) + coverageMinutes;
  const projectedAssignedDaysThisWeek = countAssignedDaysInWeekIfAssigned(
    staffAssignedDaySets[staffId],
    coverage.startTime,
    timezone,
  );
  const effectiveOvertimeThresholdMinutes =
    getEffectiveOvertimeThresholdMinutes({
      facilityPolicy,
    });
  const overtimeMinutes = Math.max(
    0,
    projectedWeekMinutes - effectiveOvertimeThresholdMinutes,
  );
  const recentMinutes = recentWorkload[staffId] || 0;
  const tieBreaker = stableHash(`${coverageId.toString()}|${staffId}`);
  const consecutiveDaysIfAssigned = getConsecutiveDaysIfAssigned(
    staffAssignedDaySets[staffId],
    coverage.startTime,
    timezone,
  );
  const preferencePenalty = getPreferencePenalty({
    staffPreferences,
    coverage,
    coverageMinutes,
    projectedWeekMinutes,
    projectedAssignedDaysThisWeek,
    consecutiveDaysIfAssigned,
    overtimeMinutes,
    timezone,
  });
  const patternPenalty = getPatternPenalty({
    schedulingPattern: facilityPolicy.schedulingPattern,
    coverageStart: coverage.startTime,
    assignedDaySet: staffAssignedDaySets[staffId],
    consecutiveDaysIfAssigned,
    projectedAssignedDaysThisWeek,
    timezone,
  });
  const weekendShiftCount = isWeekendDate(coverage.startTime, timezone)
    ? weekendShiftCounts[staffId] || 0
    : 0;
  const nightShiftCount = isNightShift(
    coverage.startTime,
    coverage.endTime,
    timezone,
  )
    ? nightShiftCounts[staffId] || 0
    : 0;
  const tagSpecificityScore = getTagSpecificityScore({
    staff,
    coverage,
  });
  const candidateTier = getSchedulingCandidateTier(staff, {
    roleFamilies: facilityConfig?.roleFamilies || [],
  });

  return {
    weekKey,
    projectedWeekMinutes,
    effectiveOvertimeThresholdMinutes,
    overtimeMinutes,
    projectedAssignedDaysThisWeek,
    consecutiveDaysIfAssigned,
    patternPenalty,
    preferencePenalty,
    weekendShiftCount,
    nightShiftCount,
    recentMinutes,
    tagSpecificityScore,
    candidateTier,
    tieBreaker,
  };
};

const compareRankingMetrics = (a, b) => {
  if (a.candidateTier !== b.candidateTier) {
    return a.candidateTier - b.candidateTier;
  }

  if (a.tagSpecificityScore !== b.tagSpecificityScore) {
    return b.tagSpecificityScore - a.tagSpecificityScore;
  }

  if (a.overtimeMinutes !== b.overtimeMinutes) {
    return a.overtimeMinutes - b.overtimeMinutes;
  }

  if (a.consecutiveDaysIfAssigned !== b.consecutiveDaysIfAssigned) {
    return a.consecutiveDaysIfAssigned - b.consecutiveDaysIfAssigned;
  }

  if (a.patternPenalty !== b.patternPenalty) {
    return a.patternPenalty - b.patternPenalty;
  }

  // Staff preferences rank below safety/cost and facility policy, but above
  // pure fairness counters so they can actually influence an assignment.
  if (a.preferencePenalty !== b.preferencePenalty) {
    return a.preferencePenalty - b.preferencePenalty;
  }

  if (a.weekendShiftCount !== b.weekendShiftCount) {
    return a.weekendShiftCount - b.weekendShiftCount;
  }

  if (a.nightShiftCount !== b.nightShiftCount) {
    return a.nightShiftCount - b.nightShiftCount;
  }

  if (a.projectedWeekMinutes !== b.projectedWeekMinutes) {
    return a.projectedWeekMinutes - b.projectedWeekMinutes;
  }

  if (a.recentMinutes !== b.recentMinutes) {
    return a.recentMinutes - b.recentMinutes;
  }

  return a.tieBreaker - b.tieBreaker;
};

const getNotSelectedReason = (candidateMetrics, cutoffMetrics) => {
  if (!cutoffMetrics) return "no cutoff available";

  if (
    candidateMetrics.tagSpecificityScore < cutoffMetrics.tagSpecificityScore
  ) {
    return `lower tag-match specificity (${candidateMetrics.tagSpecificityScore} < ${cutoffMetrics.tagSpecificityScore})`;
  }

  if (candidateMetrics.overtimeMinutes > cutoffMetrics.overtimeMinutes) {
    return `higher projected overtime (${candidateMetrics.overtimeMinutes}m > ${cutoffMetrics.overtimeMinutes}m)`;
  }

  if (
    candidateMetrics.consecutiveDaysIfAssigned >
    cutoffMetrics.consecutiveDaysIfAssigned
  ) {
    return `less favorable consecutive-day fit (${candidateMetrics.consecutiveDaysIfAssigned} > ${cutoffMetrics.consecutiveDaysIfAssigned})`;
  }

  if (candidateMetrics.patternPenalty > cutoffMetrics.patternPenalty) {
    return `less favorable ${candidateMetrics.patternPenalty > 0 ? "pattern" : "rotation"} fit (${candidateMetrics.patternPenalty} > ${cutoffMetrics.patternPenalty})`;
  }

  if (candidateMetrics.preferencePenalty > cutoffMetrics.preferencePenalty) {
    return `higher preference mismatch score (${candidateMetrics.preferencePenalty} > ${cutoffMetrics.preferencePenalty})`;
  }

  if (candidateMetrics.weekendShiftCount > cutoffMetrics.weekendShiftCount) {
    return `higher weekend assignment count (${candidateMetrics.weekendShiftCount} > ${cutoffMetrics.weekendShiftCount})`;
  }

  if (candidateMetrics.nightShiftCount > cutoffMetrics.nightShiftCount) {
    return `higher night assignment count (${candidateMetrics.nightShiftCount} > ${cutoffMetrics.nightShiftCount})`;
  }

  if (
    candidateMetrics.projectedWeekMinutes > cutoffMetrics.projectedWeekMinutes
  ) {
    return `higher projected weekly load (${candidateMetrics.projectedWeekMinutes}m > ${cutoffMetrics.projectedWeekMinutes}m)`;
  }

  if (candidateMetrics.recentMinutes > cutoffMetrics.recentMinutes) {
    return `higher recent workload (${candidateMetrics.recentMinutes}m > ${cutoffMetrics.recentMinutes}m)`;
  }

  if (candidateMetrics.tieBreaker > cutoffMetrics.tieBreaker) {
    return "tie-breaker rank lower";
  }

  return "lower overall ranking score";
};


const isEmailNotificationEnabled = (preferences) =>
  preferences?.emailNotificationsEnabled !== false;

const isSmsNotificationEnabled = (preferences) =>
  preferences?.smsNotificationsEnabled !== false;

const formatCoverageForMessage = (coverage) => ({
  coverageId: coverage._id,
  role: coverage.role,
  unitArea: coverage.unitArea || null,
  shiftType: coverage.shiftType || null,
  shiftTag: coverage.shiftTag || null,
  date: new Date(coverage.date).toISOString(),
  startTime: new Date(coverage.startTime).toISOString(),
  endTime: new Date(coverage.endTime).toISOString(),
  requiredCount: coverage.requiredCount,
  requiredCertificationTags: coverage.requiredCertificationTags || [],
});

const getFacilityTimezone = async (tenantId) => {
  const prefs = await FacilityPreferences.findOne({ tenantId })
    .select("facilityTimezone")
    .lean();
  return prefs?.facilityTimezone || "UTC";
};

// Accounts (schedulers) get email; staff contacts go through sendToStaff,
// which respects the plan, SMS consent and their notification settings.
const notifyUsersBestEffort = async ({
  tenantId,
  users,
  emailSubject,
  emailHtml,
  smsBody,
  kind = "swap",
}) => {
  const uniqueUsers = [];
  const seen = new Set();
  for (const user of users || []) {
    if (!user || !user._id) continue;
    const key = user._id.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueUsers.push(user);
  }
  if (!uniqueUsers.length) return;

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) return;
  const planKey = getEffectivePlanKey(tenant);

  for (const user of uniqueUsers) {
    try {
      if (user.loginEnabled) {
        if (user.email) {
          await sendEmail(user.email, emailSubject, emailHtml(user), null, {
            tenantId,
          });
        }
        continue;
      }
      await sendToStaff({
        tenant,
        planKey,
        staff: user,
        kind,
        sms: smsBody(user),
        emailSubject,
        emailHtml: emailHtml(user),
      });
    } catch (err) {
      console.error(
        `Failed notification for user ${user._id}:`,
        err && err.message ? err.message : err,
      );
    }
  }
};

const getTenantAdmins = (tenantId, excludeUserIds = []) =>
  findSchedulers(tenantId, excludeUserIds);

/**
 * Tell one staff member their published schedule changed (best-effort).
 * kind: "shift_added" | "shift_changed" | "shift_removed"
 */
// Scheduler edits to a published week wait for "Send changes" unless the
// request asks to send now (call-out cover, a shift starting soon).
const wantsSendNow = (req) =>
  req.body?.sendNow === true || req.query?.sendNow === "true";

const notifyShiftChange = async ({ req, staffId, kind, schedule }) => {
  try {
    const staff = await User.findOne({
      _id: staffId,
      tenantId: req.tenantId,
      loginEnabled: false,
    }).lean();
    if (!staff) return null;
    const timezone = await getFacilityTimezone(req.tenantId);
    const when = shortShift(schedule.startTime, schedule.endTime, timezone);
    const facility = req.tenant?.name || "Your facility";
    const lines = {
      shift_added: `${facility}: you've been added to ${when} (${schedule.role}).`,
      shift_changed: `${facility}: your shift changed. Now ${when} (${schedule.role}).`,
      shift_removed: `${facility}: your ${when} shift was removed from the schedule.`,
    };
    const link = await getStaffLinkUrl(staff);
    const text = `${lines[kind] || lines.shift_changed} ${link}`;
    return sendToStaff({
      tenant: req.tenant,
      planKey: getEffectivePlanKey(req.tenant),
      staff,
      kind,
      sms: text,
      emailSubject: (() => {
        const subject = text.replace(/^[^:]+: /, "");
        return subject.charAt(0).toUpperCase() + subject.slice(1);
      })(),
      emailHtml: `<p>Hi ${escapeHtml(firstName(staff.name))},</p><p>${escapeHtml(text)}</p>`,
      refId: schedule._id,
    });
  } catch (err) {
    console.error("notifyShiftChange failed:", err.message);
    return null;
  }
};

const toObjectId = (value) =>
  mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(value) : null;

const EMPTY_WARNING_METRICS = Object.freeze({
  overtimeMinutes: 0,
  consecutiveDaysIfAssigned: 0,
  patternPenalty: 0,
  weekendShiftCount: 0,
  nightShiftCount: 0,
  projectedWeekMinutes: 0,
  preferencePenalty: 0,
});

const buildUnfilledReason = ({
  reasonCode,
  message,
  skippedByReason,
  candidateCount,
  availableCount,
}) => ({
  code: reasonCode || "UNFILLED",
  message: message || "No compatible staff assignment available.",
  skippedByReason: skippedByReason || null,
  candidateCount: Number(candidateCount) || 0,
  availableCount: Number(availableCount) || 0,
});

const buildDraftStateCounts = (assignments) => {
  const counts = {
    totalSlots: 0,
    proposedSlots: 0,
    unfilledSlots: 0,
    removedSlots: 0,
    publishedSlots: 0,
  };

  for (const item of assignments || []) {
    counts.totalSlots += 1;
    if (item.state === "proposed" || item.state === "locked") {
      counts.proposedSlots += 1;
    } else if (item.state === "unfilled") {
      counts.unfilledSlots += 1;
    } else if (item.state === "removed") {
      counts.removedSlots += 1;
    } else if (item.state === "published") {
      counts.publishedSlots += 1;
    }
  }

  return counts;
};

const buildDraftAssignmentPayload = ({
  coverage,
  staff = null,
  metrics = null,
  state = "proposed",
  unfilledReason = null,
}) => ({
  assignmentId: new mongoose.Types.ObjectId(),
  coverageId: coverage._id,
  staffId: staff?._id || null,
  role: coverage.role,
  unitArea: coverage.unitArea || null,
  shiftType: coverage.shiftType || null,
  shiftTag: coverage.shiftTag || null,
  certificationTags: coverage.requiredCertificationTags || [],
  startTime: coverage.startTime,
  endTime: coverage.endTime,
  timezone: "UTC",
  notes:
    state === "unfilled"
      ? "Auto-generated unfilled slot"
      : "Auto-generated draft",
  state,
  source: "auto",
  warnings: {
    overtimeMinutes:
      (metrics || EMPTY_WARNING_METRICS).overtimeMinutes ||
      EMPTY_WARNING_METRICS.overtimeMinutes,
    consecutiveDaysIfAssigned:
      (metrics || EMPTY_WARNING_METRICS).consecutiveDaysIfAssigned ||
      EMPTY_WARNING_METRICS.consecutiveDaysIfAssigned,
    patternPenalty:
      (metrics || EMPTY_WARNING_METRICS).patternPenalty ||
      EMPTY_WARNING_METRICS.patternPenalty,
    weekendShiftCount:
      (metrics || EMPTY_WARNING_METRICS).weekendShiftCount ||
      EMPTY_WARNING_METRICS.weekendShiftCount,
    nightShiftCount:
      (metrics || EMPTY_WARNING_METRICS).nightShiftCount ||
      EMPTY_WARNING_METRICS.nightShiftCount,
    projectedWeekMinutes:
      (metrics || EMPTY_WARNING_METRICS).projectedWeekMinutes ||
      EMPTY_WARNING_METRICS.projectedWeekMinutes,
    preferencePenalty:
      (metrics || EMPTY_WARNING_METRICS).preferencePenalty ||
      EMPTY_WARNING_METRICS.preferencePenalty,
  },
  unfilledReason: state === "unfilled" ? unfilledReason : null,
});

const ensureDraftSchedule = async ({ draftId, tenantId }) => {
  const draft = await AutoScheduleDraft.findOne({
    _id: draftId,
    tenantId,
  });

  if (!draft) return null;
  if (!["draft", "partially_published"].includes(draft.status)) return null;

  return draft;
};

const buildCoverageMatchKey = (item) =>
  [
    item.role || "",
    item.unitArea || "",
    item.shiftType || "",
    item.shiftTag || "",
    new Date(item.startTime).toISOString(),
    new Date(item.endTime).toISOString(),
  ].join("-");

// Falls back to the time window for schedules created before coverageId existed.
const isSameCoverageSlot = (schedule, coverage) => {
  if (schedule?.coverageId && coverage?._id) {
    return schedule.coverageId.toString() === coverage._id.toString();
  }
  return (
    new Date(schedule.startTime).getTime() ===
      new Date(coverage.startTime).getTime() &&
    new Date(schedule.endTime).getTime() ===
      new Date(coverage.endTime).getTime()
  );
};

// Schedule docs have no coverageId, so matching a draft assignment to a
// newly created schedule falls back to the same signature used elsewhere
// (role/unitArea/shiftType/shiftTag/startTime/endTime).
const findMatchingDraftAssignment = (draft, schedule) =>
  (draft.assignments || []).find((item) => {
    if (!["proposed", "locked"].includes(item.state)) return false;
    if (item.coverageId && schedule.coverageId) {
      return item.coverageId.toString() === schedule.coverageId.toString();
    }
    return (
      normalizeRoleFamily(item.role) === normalizeRoleFamily(schedule.role) &&
      normalizeAreaTag(item.unitArea || "") ===
        normalizeAreaTag(schedule.unitArea || "") &&
      normalizeShiftType(item.shiftType || "") ===
        normalizeShiftType(schedule.shiftType || "") &&
      normalizeShiftTag(item.shiftTag || "") ===
        normalizeShiftTag(schedule.shiftTag || "") &&
      new Date(item.startTime).getTime() ===
        new Date(schedule.startTime).getTime() &&
      new Date(item.endTime).getTime() === new Date(schedule.endTime).getTime()
    );
  });

// Best-effort reconciliation: if a live schedule now covers a proposed/locked
// draft slot, mark that slot removed so it stops double-counting the gap.
// Failures are logged only — the schedule itself is the source of truth.
const autoRemoveDraftAssignmentForSchedule = async ({ tenantId, schedule }) => {
  try {
    const candidateDrafts = await AutoScheduleDraft.find({
      tenantId,
      status: { $in: ["draft", "partially_published"] },
      assignments: {
        $elemMatch: {
          state: { $in: ["proposed", "locked"] },
          ...(schedule.coverageId
            ? { coverageId: schedule.coverageId }
            : { startTime: schedule.startTime, endTime: schedule.endTime }),
        },
      },
    });

    for (const draft of candidateDrafts) {
      const assignment = findMatchingDraftAssignment(draft, schedule);
      if (!assignment) continue;

      assignment.state = "removed";
      assignment.autoRemovedBySchedule = schedule._id;
      draft.lastEditedBy = schedule.meta?.createdBy || draft.lastEditedBy;
      await draft.save();
      return { draftId: draft._id, assignmentId: assignment.assignmentId };
    }

    return null;
  } catch (err) {
    console.error(
      `Failed to auto-remove draft assignment for schedule ${schedule._id}:`,
      err && err.message ? err.message : err,
    );
    return null;
  }
};

// Reverse of autoRemoveDraftAssignmentForSchedule: reopen a draft slot that
// was auto-removed once the schedule that removed it is deleted. Only
// touches assignments this reconciliation removed (never manual removals).
const restoreAutoRemovedDraftAssignment = async ({ tenantId, schedule }) => {
  try {
    const draft = await AutoScheduleDraft.findOne({
      tenantId,
      "assignments.autoRemovedBySchedule": schedule._id,
    });
    if (!draft) return null;

    const assignment = draft.assignments.find(
      (item) =>
        item.state === "removed" &&
        item.autoRemovedBySchedule &&
        item.autoRemovedBySchedule.toString() === schedule._id.toString(),
    );
    if (!assignment) return null;

    assignment.autoRemovedBySchedule = null;
    if (assignment.staffId) {
      assignment.state = "proposed";
      assignment.unfilledReason = null;
    } else {
      assignment.state = "unfilled";
      assignment.unfilledReason = buildUnfilledReason({
        reasonCode: "STAFF_UNASSIGNED",
        message: "Coverage reopened after the linked schedule was deleted.",
      });
    }

    await draft.save();
    return { draftId: draft._id, assignmentId: assignment.assignmentId };
  } catch (err) {
    console.error(
      `Failed to restore draft assignment for deleted schedule ${schedule._id}:`,
      err && err.message ? err.message : err,
    );
    return null;
  }
};

// Date keys (YYYY-MM-DD) of every day in a published week from last week on.
const getPublishedDates = async (tenantId) => {
  const { timezone, weekStartsOn } = await getWeekSettings(tenantId);
  const lastWeek = addDaysToKey(
    weekStartFor(new Date(), timezone, weekStartsOn),
    -7,
  );
  const weeks = await ScheduleWeek.find({
    tenantId,
    status: "published",
    weekStart: { $gte: dateKeyToCoverageDate(lastWeek) },
  })
    .select("weekStart")
    .lean();
  const dates = [];
  for (const week of weeks) {
    for (let day = 0; day < 7; day += 1) {
      dates.push(new Date(week.weekStart.getTime() + day * 86400000));
    }
  }
  return dates;
};

const getOpenCoverageForStaff = async ({ tenantId, staff, facilityConfig }) => {
  const now = new Date();
  // Staff only see open shifts in weeks the scheduler has published.
  const publishedDates = await getPublishedDates(tenantId);
  if (!publishedDates.length) return [];
  const coverages = await Coverage.find({
    tenantId,
    startTime: { $gt: now },
    date: { $in: publishedDates },
  })
    .sort({ date: 1, startTime: 1 })
    .lean();

  if (!coverages.length) return [];

  // Coverage tied to an in-progress AI draft is still open for pickup until a
  // live Schedule exists for it (see remaining/assignedCount below).
  // Hide slots I'm already on, called out of, or that overlap my shifts.
  const myShifts = await Schedule.find({
    tenantId,
    staffId: staff._id,
    endTime: { $gt: now },
    status: { $in: [...PICKUP_ACTIVE_STATUSES, "call_out"] },
  })
    .select("coverageId startTime endTime status")
    .lean();
  const myCoverageIds = new Set(
    myShifts.filter((s) => s.coverageId).map((s) => String(s.coverageId)),
  );
  const overlapsMyShift = (coverage) =>
    myShifts.some(
      (s) =>
        s.status !== "call_out" &&
        new Date(s.startTime) < new Date(coverage.endTime) &&
        new Date(s.endTime) > new Date(coverage.startTime),
    );

  const eligibleCoverages = coverages.filter(
    (coverage) =>
      !myCoverageIds.has(String(coverage._id)) &&
      !overlapsMyShift(coverage) &&
      isStaffCompatibleWithCoverage({
        staff,
        coverage,
        facilityConfig,
      }),
  );
  if (!eligibleCoverages.length) return [];

  const assignedByCoverage = await countAssignmentsByCoverage({
    tenantId,
    coverageIds: eligibleCoverages.map((coverage) => coverage._id),
    statuses: PICKUP_ACTIVE_STATUSES,
  });

  return eligibleCoverages
    .map((coverage) => {
      const assignedCount =
        assignedByCoverage.get(coverage._id.toString()) || 0;
      return {
        ...coverage,
        assignedCount,
        remaining: Math.max(0, coverage.requiredCount - assignedCount),
      };
    })
    .filter((coverage) => coverage.remaining > 0);
};

exports.getOpenCoverageForMe = async (req, res, next) => {
  try {
    const facilityPreferences = await FacilityPreferences.findOne({
      tenantId: req.tenantId,
    }).lean();
    const facilityConfig = getCompatibleFacilityConfig(facilityPreferences);
    const coverages = await getOpenCoverageForStaff({
      tenantId: req.tenantId,
      staff: req.user,
      facilityConfig,
    });

    res.json(coverages);
  } catch (err) {
    next(err);
  }
};

/**
 * Puts `staff` on an open slot of `coverageId`, safely.
 * Used by link pickup and by YES replies to call-out texts.
 * Returns { ok: true, schedule } or { ok: false, status, code, message }.
 */
const CLAIM_LOCK_MS = 10 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Takes the per-slot claim lock (atomic single-document update), so claims
 * on the same slot run one at a time across every server process.
 */
const acquireClaimLock = async (tenantId, coverageId) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const now = new Date();
    const locked = await Coverage.findOneAndUpdate(
      {
        _id: coverageId,
        tenantId,
        $or: [{ claimLockUntil: null }, { claimLockUntil: { $lt: now } }],
      },
      { $set: { claimLockUntil: new Date(now.getTime() + CLAIM_LOCK_MS) } },
      { new: true, timestamps: false },
    );
    if (locked) return locked.claimLockUntil;
    await sleep(50 + Math.floor(Math.random() * 50));
  }
  return null;
};

const releaseClaimLock = (tenantId, coverageId, lockUntil) =>
  Coverage.updateOne(
    { _id: coverageId, tenantId, claimLockUntil: lockUntil },
    { $set: { claimLockUntil: null } },
    { timestamps: false },
  ).catch(() => {});

/**
 * Puts `staff` on an open slot of `coverageId`, safely.
 * Used by link pickup and by YES replies to call-out texts.
 * Returns { ok: true, schedule } or { ok: false, status, code, message }.
 */
const claimCoverage = async ({ tenantId, coverageId, staff, source }) => {
  if (!coverageId || !mongoose.isValidObjectId(coverageId)) {
    return { ok: false, status: 400, code: "INVALID_COVERAGE", message: "Valid coverageId is required" };
  }
  const lockUntil = await acquireClaimLock(tenantId, coverageId);
  if (!lockUntil) {
    const exists = await Coverage.exists({ _id: coverageId, tenantId });
    return exists
      ? { ok: false, status: 409, code: "BUSY", message: "Someone else is taking this shift right now; try again" }
      : { ok: false, status: 404, code: "COVERAGE_NOT_FOUND", message: "Coverage not found" };
  }
  try {
    return await claimCoverageLocked({ tenantId, coverageId, staff, source });
  } finally {
    await releaseClaimLock(tenantId, coverageId, lockUntil);
  }
};

const claimCoverageLocked = async ({ tenantId, coverageId, staff, source }) => {
  if (!coverageId || !mongoose.isValidObjectId(coverageId)) {
    return { ok: false, status: 400, code: "INVALID_COVERAGE", message: "Valid coverageId is required" };
  }

  const [coverage, facilityPreferences] = await Promise.all([
    Coverage.findOne({ _id: coverageId, tenantId }),
    FacilityPreferences.findOne({ tenantId }).lean(),
  ]);
  if (!coverage) {
    return { ok: false, status: 404, code: "COVERAGE_NOT_FOUND", message: "Coverage not found" };
  }
  if (coverage.startTime <= new Date()) {
    return { ok: false, status: 400, code: "SHIFT_STARTED", message: "Only future shifts can be picked up" };
  }

  const facilityConfig = getCompatibleFacilityConfig(facilityPreferences);
  const openCoverages = await getOpenCoverageForStaff({
    tenantId,
    staff,
    facilityConfig,
  });
  if (!openCoverages.some((item) => String(item._id) === String(coverage._id))) {
    return { ok: false, status: 409, code: "SHIFT_ALREADY_FILLED", message: "This shift is no longer available" };
  }

  const timeOff = await TimeOff.findOne({
    tenantId,
    staffId: staff._id,
    status: "approved",
    startTime: { $lte: coverage.endTime },
    endTime: { $gte: coverage.startTime },
  });
  if (timeOff) {
    return { ok: false, status: 409, code: "TIME_OFF", message: "You have approved time off overlapping this shift" };
  }

  const conflict = await hasConflict({
    tenantId,
    staffId: staff._id,
    startTime: coverage.startTime,
    endTime: coverage.endTime,
  });
  if (conflict) {
    return { ok: false, status: 409, code: "CONFLICT", message: "You're already working then", conflict };
  }

  const schedule = await Schedule.create({
    tenantId,
    staffId: staff._id,
    coverageId: coverage._id,
    role: coverage.role,
    unitArea: coverage.unitArea,
    shiftType: coverage.shiftType,
    shiftTag: coverage.shiftTag,
    certificationTags: coverage.requiredCertificationTags || [],
    startTime: coverage.startTime,
    endTime: coverage.endTime,
    timezone: facilityPreferences?.facilityTimezone || "UTC",
    notes:
      source === "callout" ? "Took a call-out shift" : "Picked up by staff member",
    status: "scheduled",
    state: "published",
    meta: { createdBy: staff._id, source, publishedAt: new Date() },
  });

  // Belt and braces (the claim lock already serializes claims): if the slot
  // is somehow over capacity now, undo this one.
  const occupying = await Schedule.countDocuments({
    tenantId,
    coverageId: coverage._id,
    status: { $in: COVERAGE_OCCUPYING_STATUSES },
  });
  if (occupying > coverage.requiredCount) {
    await Schedule.deleteOne({ _id: schedule._id });
    return { ok: false, status: 409, code: "SHIFT_ALREADY_FILLED", message: "Sorry, someone just took this shift" };
  }

  await autoRemoveDraftAssignmentForSchedule({ tenantId, schedule });
  await markOfferFilledIfAny({ tenantId, coverageId: coverage._id, staffId: staff._id });
  return { ok: true, schedule };
};
exports.claimCoverage = claimCoverage;

exports.pickUpSchedule = async (req, res, next) => {
  try {
    const result = await claimCoverage({
      tenantId: req.tenantId,
      coverageId: req.body?.coverageId,
      staff: req.user,
      source: "staff_pickup",
    });
    if (!result.ok) {
      return res.status(result.status).json({
        message: result.message,
        errorCode: result.code,
        ...(result.conflict ? { conflict: result.conflict } : {}),
      });
    }
    res
      .status(201)
      .json({ message: "Shift picked up successfully", schedule: result.schedule });
  } catch (err) {
    next(err);
  }
};

// AUTO-GENERATE DRAFT SCHEDULE FOR SELECTED COVERAGES
exports.autoGenerateSchedule = async (req, res, next) => {
  try {
    const { coverageIds } = req.body;

    if (!coverageIds || !Array.isArray(coverageIds) || !coverageIds.length) {
      console.log("No coverageIds provided");
      return res.status(400).json({
        status: "error",
        errorCode: "COVERAGE_IDS_REQUIRED",
        message: "coverageIds are required",
        hint: "Select at least one coverage and try AI-generate again.",
      });
    }

    const tenantId = req.tenantId;
    const facilityPreferences = await FacilityPreferences.findOne({
      tenantId,
    }).lean();
    const facilityPolicy = getEffectiveFacilityPolicy(facilityPreferences);
    const facilityConfig = getCompatibleFacilityConfig(facilityPreferences);
    const facilityTimezone = normalizeZone(
      facilityPreferences?.facilityTimezone,
    );

    // 1) GET COVERAGE DETAILS
    const coverageList = await Coverage.find({
      tenantId,
      _id: { $in: coverageIds },
    }).sort({ date: 1, startTime: 1 });

    if (!coverageList.length) {
      console.log("No valid coverage found");
      return res.status(404).json({
        status: "error",
        errorCode: "NO_VALID_COVERAGE_FOUND",
        message: "No valid coverage found for the selected coverageIds",
        hint: "Refresh coverage data and reselect open coverage items.",
      });
    }

    console.log(`Found ${coverageList.length} coverage(s) to process`);

    // 2) LOAD TIME OFF
    const end = new Date(Math.max(...coverageList.map((c) => c.endTime)));
    const start = new Date(Math.min(...coverageList.map((c) => c.startTime)));
    const fairnessWindowStart = new Date(start);
    fairnessWindowStart.setUTCDate(
      fairnessWindowStart.getUTCDate() - facilityPolicy.fairnessLookbackDays,
    );
    const firstCoverageWeekStart = getWeekStart(start, facilityTimezone);
    const lastCoverageWeekStart = getWeekStart(end, facilityTimezone);
    const weeklyWindowEnd = new Date(lastCoverageWeekStart);
    weeklyWindowEnd.setUTCDate(weeklyWindowEnd.getUTCDate() + 7);

    const timeOff = await TimeOff.find({
      tenantId,
      status: "approved",
      startTime: { $lte: end },
      endTime: { $gte: start },
    });

    const timeOffMap = {};
    timeOff.forEach((t) => {
      const id = t.staffId.toString();
      if (!timeOffMap[id]) timeOffMap[id] = [];
      timeOffMap[id].push(t);
    });

    console.log(`Loaded time-off records for ${timeOff.length} staff`);

    // 3) LOAD EXISTING SCHEDULES (ignore terminal statuses; keep call_out for availability checks)
    const existingSchedules = await Schedule.find({
      tenantId,
      status: { $nin: ["completed", "left_early", "no_show", "cancelled"] },
      startTime: { $gte: start, $lte: end },
    });

    const existingByStaff = {};
    existingSchedules.forEach((s) => {
      const id = s.staffId.toString();
      if (!existingByStaff[id]) existingByStaff[id] = [];
      existingByStaff[id].push(s);
    });

    const fairnessSchedules = await Schedule.find({
      tenantId,
      status: { $in: ["scheduled", "completed"] },
      startTime: { $lte: end },
      endTime: { $gte: fairnessWindowStart },
    }).select("staffId startTime endTime");

    const recentWorkload = {};
    const weeklyWorkload = {};
    const weekendShiftCounts = {};
    const nightShiftCounts = {};
    const staffAssignedDaySets = {};
    const trackedScheduleKeys = new Set();

    fairnessSchedules.forEach((schedule) => {
      const staffId = schedule.staffId.toString();
      const minutes = minutesBetween(schedule.startTime, schedule.endTime);

      recentWorkload[staffId] = (recentWorkload[staffId] || 0) + minutes;

      const scheduleWeekStart = getWeekStart(
        schedule.startTime,
        facilityTimezone,
      );
      if (
        scheduleWeekStart >= firstCoverageWeekStart &&
        scheduleWeekStart < weeklyWindowEnd
      ) {
        const key = buildWeekKey(staffId, schedule.startTime, facilityTimezone);
        weeklyWorkload[key] = (weeklyWorkload[key] || 0) + minutes;
      }

      addTrackedSchedule({
        schedule,
        trackedKeys: trackedScheduleKeys,
        staffAssignedDaySets,
        weekendShiftCounts,
        nightShiftCounts,
        timezone: facilityTimezone,
      });
    });

    existingSchedules.forEach((schedule) => {
      addTrackedSchedule({
        schedule,
        trackedKeys: trackedScheduleKeys,
        staffAssignedDaySets,
        weekendShiftCounts,
        nightShiftCounts,
        timezone: facilityTimezone,
      });
    });

    console.log(
      `Loaded existing schedules for ${existingSchedules.length} shifts`,
    );

    const generated = [];
    const coverageResults = [];
    const notifications = {
      email: { sent: 0, failed: 0 },
      sms: { sent: 0, failed: 0 },
    };
    const tenantUsers = await User.find({ tenantId, loginEnabled: false, status: "active" }).select(
      "name email role roles allowedAreas allowedShiftTypes certificationTags userPhone userPhoneCountryCode",
    );

    // 4) LOOP THROUGH COVERAGES
    for (const cov of coverageList) {
      console.log(
        `\nProcessing coverage: ${cov._id}, role: ${cov.role}, start: ${cov.startTime}, end: ${cov.endTime}`,
      );

      const coverageMeta = formatCoverageForMessage(cov);

      const coverageMinutes = minutesBetween(cov.startTime, cov.endTime);

      const alreadyAssigned = existingSchedules.filter(
        (s) => s.status !== "call_out" && isSameCoverageSlot(s, cov),
      );

      const needed = cov.requiredCount - alreadyAssigned.length;
      console.log(`${needed} staff needed for this coverage`);

      if (needed <= 0) {
        console.log("Coverage already fully assigned");
        coverageResults.push({
          ...coverageMeta,
          status: "already_filled",
          reasonCode: "ALREADY_FULLY_ASSIGNED",
          message: "Coverage is already fully assigned.",
          assignedCount: 0,
          alreadyAssignedCount: alreadyAssigned.length,
          neededCount: 0,
          unfilledCount: 0,
          assignments: [],
        });
        continue;
      }

      const roleStaff = tenantUsers.filter((staff) =>
        isStaffCompatibleWithCoverage({
          staff,
          coverage: cov,
          facilityConfig,
        }),
      );
      if (!roleStaff.length) {
        console.log(
          `No staff found for compatible role/area/shift/certifications for ${cov.role}`,
        );

        const unfilledReason = buildUnfilledReason({
          reasonCode: "NO_STAFF_FOR_ROLE",
          message: `No staff found with a compatible role, area, shift type, and certification profile for ${cov.role}.`,
          candidateCount: 0,
          availableCount: 0,
        });
        const unfilledSlots = Array.from({ length: needed }).map(() =>
          buildDraftAssignmentPayload({
            coverage: cov,
            state: "unfilled",
            unfilledReason,
          }),
        );
        generated.push(...unfilledSlots);

        coverageResults.push({
          ...coverageMeta,
          status: "unfilled",
          reasonCode: "NO_STAFF_FOR_ROLE",
          message: `No staff found with a compatible role, area, shift type, and certification profile for ${cov.role}.`,
          assignedCount: 0,
          neededCount: needed,
          availableCount: 0,
          alreadyAssignedCount: alreadyAssigned.length,
          unfilledCount: needed,
          assignments: unfilledSlots.map((slot) => ({
            assignmentId: slot.assignmentId,
            state: slot.state,
            staffId: null,
            staffName: null,
            unfilledReason: slot.unfilledReason,
            warnings: slot.warnings,
          })),
        });
        continue;
      }

      const staffIds = roleStaff.map((u) => u._id.toString());

      const prefs = await Preferences.find({
        tenantId,
        staffId: { $in: staffIds },
      });

      const prefMap = {};
      prefs.forEach((p) => (prefMap[p.staffId.toString()] = p));

      // FILTER AVAILABLE STAFF
      let available = [];
      const skippedByReason = {};
      for (const staff of roleStaff) {
        const id = staff._id.toString();
        const currentStaffSchedules = existingByStaff[id] || [];
        let skipReason = null;

        if (
          currentStaffSchedules.some(
            (s) => s.status === "call_out" && isSameCoverageSlot(s, cov),
          )
        ) {
          skipReason = `called out for this shift`;
        } else if (
          timeOffMap[id]?.some(
            (to) =>
              new Date(to.startTime) <= cov.endTime &&
              new Date(to.endTime) >= cov.startTime,
          )
        ) {
          skipReason = `has approved time off overlapping coverage`;
        } else if (
          currentStaffSchedules.some(
            (s) =>
              s.status !== "call_out" &&
              !(s.endTime <= cov.startTime || s.startTime >= cov.endTime),
          )
        ) {
          skipReason = `already scheduled for overlapping shift`;
        }

        if (skipReason) {
          skippedByReason[skipReason] = (skippedByReason[skipReason] || 0) + 1;
          console.log(`Skipping staff ${staff.name} (${id}): ${skipReason}`);
        } else {
          available.push(staff);
          console.log(`Staff ${staff.name} (${id}) is available`);
        }
      }

      if (!available.length) {
        console.log("No available staff for this coverage");

        const unfilledReason = buildUnfilledReason({
          reasonCode: "NO_AVAILABLE_STAFF",
          message:
            "No eligible staff available due to conflicts, time off, call out, availability preferences, or break constraints.",
          skippedByReason,
          candidateCount: roleStaff.length,
          availableCount: 0,
        });
        const unfilledSlots = Array.from({ length: needed }).map(() =>
          buildDraftAssignmentPayload({
            coverage: cov,
            state: "unfilled",
            unfilledReason,
          }),
        );
        generated.push(...unfilledSlots);

        coverageResults.push({
          ...coverageMeta,
          status: "unfilled",
          reasonCode: "NO_AVAILABLE_STAFF",
          message:
            "No eligible staff available due to conflicts, time off, call out, availability preferences, or break constraints.",
          assignedCount: 0,
          neededCount: needed,
          availableCount: 0,
          alreadyAssignedCount: alreadyAssigned.length,
          unfilledCount: needed,
          skippedByReason,
          assignments: unfilledSlots.map((slot) => ({
            assignmentId: slot.assignmentId,
            state: slot.state,
            staffId: null,
            staffName: null,
            unfilledReason: slot.unfilledReason,
            warnings: slot.warnings,
          })),
        });
        continue;
      }

      const rankedCandidates = available
        .map((staff) => {
          const staffId = staff._id.toString();
          return {
            staff,
            metrics: buildRankingMetrics({
              staff,
              staffId,
              coverage: cov,
              coverageMinutes,
              coverageId: cov._id,
              facilityPolicy,
              facilityConfig,
              staffPreferences: prefMap[staffId],
              weeklyWorkload,
              recentWorkload,
              weekendShiftCounts,
              nightShiftCounts,
              staffAssignedDaySets,
              timezone: facilityTimezone,
            }),
          };
        })
        .sort((a, b) => compareRankingMetrics(a.metrics, b.metrics));

      console.log(
        `[Ranking] Coverage ${cov._id}: ranked ${rankedCandidates.length} eligible staff (need ${needed}).`,
      );
      rankedCandidates.forEach((entry, rankIndex) => {
        const { staff, metrics } = entry;
        console.log(
          `[Ranking] #${rankIndex + 1} ${staff.name || "Unknown"} (${staff._id}) -> overtime=${metrics.overtimeMinutes}m, streak=${metrics.consecutiveDaysIfAssigned}, pattern=${metrics.patternPenalty}, weekend=${metrics.weekendShiftCount}, night=${metrics.nightShiftCount}, projectedDaysWeek=${metrics.projectedAssignedDaysThisWeek}, projectedWeek=${metrics.projectedWeekMinutes}m, recent${facilityPolicy.fairnessLookbackDays}d=${metrics.recentMinutes}m, pref=${metrics.preferencePenalty}, tie=${metrics.tieBreaker}`,
        );
      });

      const selectedRanked = rankedCandidates.slice(0, needed);
      const cutoffMetrics =
        selectedRanked.length > 0
          ? selectedRanked[selectedRanked.length - 1].metrics
          : null;

      rankedCandidates.slice(needed).forEach((entry) => {
        const reason = getNotSelectedReason(entry.metrics, cutoffMetrics);
        console.log(
          `[Not Selected] ${entry.staff.name || "Unknown"} (${entry.staff._id}) for coverage ${cov._id}: ${reason}`,
        );
      });

      const assignmentDetails = [];

      for (const entry of selectedRanked) {
        const { staff, metrics } = entry;
        const draftAssignment = buildDraftAssignmentPayload({
          coverage: cov,
          staff,
          metrics,
        });

        console.log(
          `Drafted staff ${staff.name} (${staff._id}) for coverage ${cov._id}`,
        );

        generated.push(draftAssignment);
        assignmentDetails.push({
          assignmentId: draftAssignment.assignmentId,
          state: draftAssignment.state,
          staffId: staff._id,
          staffName: staff.name,
          warnings: draftAssignment.warnings,
        });

        const staffId = staff._id.toString();
        recentWorkload[staffId] =
          (recentWorkload[staffId] || 0) + coverageMinutes;
        const weekKey = buildWeekKey(staffId, cov.startTime, facilityTimezone);
        weeklyWorkload[weekKey] =
          (weeklyWorkload[weekKey] || 0) + coverageMinutes;

        existingSchedules.push(draftAssignment);
        if (!existingByStaff[staff._id]) existingByStaff[staff._id] = [];
        existingByStaff[staff._id].push(draftAssignment);
        addTrackedSchedule({
          schedule: draftAssignment,
          trackedKeys: trackedScheduleKeys,
          staffAssignedDaySets,
          weekendShiftCounts,
          nightShiftCounts,
          timezone: facilityTimezone,
        });
      }

      const assignedCount = selectedRanked.length;
      const unfilledCount = Math.max(0, needed - assignedCount);

      if (unfilledCount > 0) {
        const unfilledReason = buildUnfilledReason({
          reasonCode: "INSUFFICIENT_CANDIDATES",
          message:
            "Not enough eligible staff remained after ranking and conflict checks.",
          skippedByReason,
          candidateCount: roleStaff.length,
          availableCount: available.length,
        });

        for (let index = 0; index < unfilledCount; index += 1) {
          const unfilledAssignment = buildDraftAssignmentPayload({
            coverage: cov,
            state: "unfilled",
            unfilledReason,
          });
          generated.push(unfilledAssignment);
          assignmentDetails.push({
            assignmentId: unfilledAssignment.assignmentId,
            state: unfilledAssignment.state,
            staffId: null,
            staffName: null,
            unfilledReason: unfilledAssignment.unfilledReason,
            warnings: unfilledAssignment.warnings,
          });
        }
      }

      coverageResults.push({
        ...coverageMeta,
        status:
          assignedCount === 0
            ? "unfilled"
            : unfilledCount > 0
              ? "partially_filled"
              : "filled",
        message:
          unfilledCount > 0
            ? `Assigned ${assignedCount} of ${needed} needed staff.`
            : `Assigned ${assignedCount} staff successfully.`,
        assignedCount,
        neededCount: needed,
        availableCount: available.length,
        alreadyAssignedCount: alreadyAssigned.length,
        unfilledCount,
        skippedByReason,
        assignments: assignmentDetails,
      });
    }

    console.log(
      `\nAuto-scheduling complete, ${generated.length} draft assignment(s) generated`,
    );

    const slotCounts = buildDraftStateCounts(generated);

    const summary = {
      requestedCoverageIds: coverageIds.length,
      processedCoverageCount: coverageList.length,
      generatedAssignmentCount: slotCounts.proposedSlots,
      totalSlots: slotCounts.totalSlots,
      proposedSlots: slotCounts.proposedSlots,
      unfilledSlots: slotCounts.unfilledSlots,
      removedSlots: slotCounts.removedSlots,
      publishedSlots: slotCounts.publishedSlots,
      filledCoverageCount: coverageResults.filter((r) => r.status === "filled")
        .length,
      partiallyFilledCoverageCount: coverageResults.filter(
        (r) => r.status === "partially_filled",
      ).length,
      unfilledCoverageCount: coverageResults.filter(
        (r) => r.status === "unfilled",
      ).length,
      skippedCoverageCount: coverageResults.filter(
        (r) => r.status === "skipped",
      ).length,
      alreadyFilledCoverageCount: coverageResults.filter(
        (r) => r.status === "already_filled",
      ).length,
      policySource: facilityPreferences ? "facility_preferences" : "defaults",
      facilityPolicy: {
        schedulingPattern: facilityPolicy.schedulingPattern,
        weeklyOvertimeThresholdHours:
          facilityPolicy.weeklyOvertimeThresholdHours,
        fairnessLookbackDays: facilityPolicy.fairnessLookbackDays,
      },
      notifications,
    };

    const draft = await AutoScheduleDraft.create({
      tenantId,
      createdBy: req.user._id,
      status: "draft",
      coverageIds: coverageList.map((coverage) => coverage._id),
      policySource: facilityPreferences ? "facility_preferences" : "defaults",
      facilityPolicy: {
        schedulingPattern: facilityPolicy.schedulingPattern,
        weeklyOvertimeThresholdHours:
          facilityPolicy.weeklyOvertimeThresholdHours,
        fairnessLookbackDays: facilityPolicy.fairnessLookbackDays,
      },
      summary: {
        requestedCoverageIds: summary.requestedCoverageIds,
        processedCoverageCount: summary.processedCoverageCount,
        generatedAssignmentCount: summary.generatedAssignmentCount,
        totalSlots: summary.totalSlots,
        proposedSlots: summary.proposedSlots,
        unfilledSlots: summary.unfilledSlots,
        removedSlots: summary.removedSlots,
        publishedSlots: summary.publishedSlots,
        filledCoverageCount: summary.filledCoverageCount,
        partiallyFilledCoverageCount: summary.partiallyFilledCoverageCount,
        unfilledCoverageCount: summary.unfilledCoverageCount,
        skippedCoverageCount: summary.skippedCoverageCount,
        alreadyFilledCoverageCount: summary.alreadyFilledCoverageCount,
      },
      assignments: generated,
      lastEditedBy: req.user._id,
    });

    const coveredItemsCount =
      summary.filledCoverageCount + summary.partiallyFilledCoverageCount;

    let successMessage = "";
    if (!generated.length) {
      successMessage =
        "No assignments were generated from the selected coverage. Draft was created with 0 assignments.";
    } else if (summary.partiallyFilledCoverageCount > 0) {
      successMessage = `Auto-scheduling draft created: ${generated.length} assignment(s) across ${coveredItemsCount} coverage item(s), with ${summary.partiallyFilledCoverageCount} partially filled.`;
    } else {
      successMessage = `Auto-scheduling draft created: ${generated.length} assignment(s) across ${coveredItemsCount} coverage item(s).`;
    }

    const warningParts = [];
    if (summary.skippedCoverageCount) {
      warningParts.push(
        `${summary.skippedCoverageCount} coverage item(s) were skipped.`,
      );
    }
    if (summary.alreadyFilledCoverageCount) {
      warningParts.push(
        `${summary.alreadyFilledCoverageCount} coverage item(s) were already fully assigned.`,
      );
    }
    const warningMessage = warningParts.length
      ? `${warningParts.join(" ")} Review coverageResults for details.`
      : null;

    res.json({
      status: "success",
      message: successMessage,
      warning: warningMessage,
      summary,
      draftCreated: Boolean(draft),
      draftSchedule: draft
        ? {
            draftId: draft._id,
            status: draft.status,
            slotCounts: buildDraftStateCounts(draft.assignments || []),
          }
        : null,
      coverageResults,
      generatedCount: generated.length,
      draftAssignments: draft ? draft.assignments : [],
    });
  } catch (err) {
    console.error("Error in autoGenerateSchedule:", err);
    return res.status(500).json({
      status: "error",
      errorCode: "AUTO_SCHEDULE_FAILED",
      message:
        "Auto-scheduling failed. Please try again, and contact support if the issue persists.",
      details: err && err.message ? err.message : "Unknown error",
    });
  }
};

exports.getAutoScheduleDrafts = async (req, res, next) => {
  try {
    const { status = "draft", limit = 20 } = req.query;

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const filter = { tenantId: req.tenantId };
    if (status && status !== "all") {
      filter.status = status;
    }

    const drafts = await AutoScheduleDraft.find(filter)
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .populate("createdBy", "name email")
      .populate("publishedBy", "name email")
      .populate("discardedBy", "name email");

    const draftsWithCounts = drafts.map((draft) => {
      const draftObject = draft.toObject();
      draftObject.slotCounts = buildDraftStateCounts(draftObject.assignments);
      return draftObject;
    });

    res.json(draftsWithCounts);
  } catch (err) {
    next(err);
  }
};

exports.getAutoScheduleDraftById = async (req, res, next) => {
  try {
    const draft = await AutoScheduleDraft.findOne({
      _id: req.params.draftId,
      tenantId: req.tenantId,
    })
      .populate("createdBy", "name email")
      .populate("publishedBy", "name email")
      .populate("discardedBy", "name email");

    if (!draft) {
      return res.status(404).json({ message: "Draft schedule not found" });
    }

    const draftObject = draft.toObject();
    draftObject.slotCounts = buildDraftStateCounts(draftObject.assignments);

    res.json(draftObject);
  } catch (err) {
    next(err);
  }
};

exports.updateAutoScheduleDraftAssignment = async (req, res, next) => {
  try {
    const draft = await ensureDraftSchedule({
      draftId: req.params.draftId,
      tenantId: req.tenantId,
    });

    if (!draft) {
      return res.status(404).json({ message: "Draft schedule not found" });
    }

    const assignmentId = toObjectId(req.params.assignmentId);
    if (!assignmentId) {
      return res.status(400).json({ message: "Invalid assignmentId" });
    }

    const assignment = draft.assignments.find(
      (item) => item.assignmentId.toString() === assignmentId.toString(),
    );

    if (!assignment) {
      return res.status(404).json({ message: "Draft assignment not found" });
    }

    const {
      staffId,
      state,
      notes,
      startTime,
      endTime,
      unitArea,
      shiftType,
      shiftTag,
      certificationTags,
      force,
    } = req.body;

    const hasStaffIdInBody = Object.prototype.hasOwnProperty.call(
      req.body,
      "staffId",
    );

    if (state !== undefined) {
      assignment.state = state;
    }

    if (notes !== undefined) {
      assignment.notes = notes;
    }

    if (startTime !== undefined) {
      assignment.startTime = new Date(startTime);
    }

    if (endTime !== undefined) {
      assignment.endTime = new Date(endTime);
    }

    if (unitArea !== undefined) {
      assignment.unitArea = normalizeAreaTag(unitArea) || null;
    }

    if (shiftType !== undefined) {
      assignment.shiftType = normalizeShiftType(shiftType) || null;
    }

    if (shiftTag !== undefined) {
      assignment.shiftTag = normalizeShiftTag(shiftTag) || null;
    }

    if (Array.isArray(certificationTags)) {
      assignment.certificationTags = dedupeStrings(certificationTags);
    }

    if (hasStaffIdInBody) {
      if (staffId === null || String(staffId).trim() === "") {
        assignment.staffId = null;
        assignment.state = "unfilled";
        assignment.unfilledReason = buildUnfilledReason({
          reasonCode: "STAFF_UNASSIGNED",
          message: "Staff cleared from draft slot by scheduler.",
        });
      } else {
        if (!mongoose.isValidObjectId(staffId)) {
          return res.status(400).json({ message: "Invalid staffId" });
        }
        assignment.staffId = toObjectId(staffId);
        assignment.state = "proposed";
        assignment.unfilledReason = null;
      }
    }

    if (!assignment.staffId) {
      if (
        state &&
        ["proposed", "locked", "published"].includes(state) &&
        !force
      ) {
        return res.status(400).json({
          message:
            "staffId is required when state is proposed, locked, or published",
        });
      }
      if (assignment.state !== "removed") {
        assignment.state = "unfilled";
        if (!assignment.unfilledReason) {
          assignment.unfilledReason = buildUnfilledReason({
            reasonCode: "STAFF_UNASSIGNED",
            message: "No staff assigned to this draft slot.",
          });
        }
      }
    } else if (assignment.state === "unfilled") {
      assignment.state = "proposed";
      assignment.unfilledReason = null;
    }

    const facilityPreferences = await FacilityPreferences.findOne({
      tenantId: req.tenantId,
    }).lean();
    const facilityConfig = getCompatibleFacilityConfig(facilityPreferences);

    if (assignment.staffId) {
      const staff = await User.findOne({
        _id: assignment.staffId,
        tenantId: req.tenantId,
      }).select("role allowedAreas allowedShiftTypes certificationTags");

      if (!staff) {
        return res.status(404).json({ message: "Staff not found" });
      }

      const compatibilityTarget = {
        role: assignment.role,
        unitArea: assignment.unitArea,
        shiftType: assignment.shiftType,
        shiftTag: assignment.shiftTag,
        requiredCertificationTags: assignment.certificationTags,
      };

      if (
        !isStaffCompatibleWithCoverage({
          staff,
          coverage: compatibilityTarget,
          facilityConfig,
        }) &&
        !force
      ) {
        return res.status(400).json({
          message:
            "Staff is not compatible with this draft assignment. Pass force=true to override.",
        });
      }
    }

    if (
      ["proposed", "locked"].includes(assignment.state) &&
      assignment.staffId
    ) {
      const conflict = await hasConflict({
        tenantId: req.tenantId,
        staffId: assignment.staffId,
        startTime: assignment.startTime,
        endTime: assignment.endTime,
      });

      if (conflict && !force) {
        return res.status(409).json({
          message: "Staff has a conflicting published schedule",
          conflict,
        });
      }

      const draftConflict = draft.assignments.find(
        (item) =>
          item.assignmentId.toString() !== assignment.assignmentId.toString() &&
          item.staffId &&
          item.staffId.toString() === assignment.staffId.toString() &&
          ["proposed", "locked"].includes(item.state) &&
          item.startTime < assignment.endTime &&
          item.endTime > assignment.startTime,
      );

      if (draftConflict && !force) {
        return res.status(409).json({
          message: "Staff has a conflicting assignment in this draft schedule",
          conflict: {
            assignmentId: draftConflict.assignmentId,
            startTime: draftConflict.startTime,
            endTime: draftConflict.endTime,
            coverageId: draftConflict.coverageId,
          },
        });
      }
    }

    draft.lastEditedBy = req.user._id;
    await draft.save();

    const updatedAssignment = draft.assignments.find(
      (item) =>
        item.assignmentId.toString() === assignment.assignmentId.toString(),
    );

    res.json({
      message: "Draft assignment updated",
      assignment: updatedAssignment,
      slotCounts: buildDraftStateCounts(draft.assignments || []),
    });
  } catch (err) {
    next(err);
  }
};

exports.fillAutoScheduleDraftAssignmentWithAI = async (req, res, next) => {
  try {
    const draft = await ensureDraftSchedule({
      draftId: req.params.draftId,
      tenantId: req.tenantId,
    });

    if (!draft) {
      return res.status(404).json({ message: "Draft schedule not found" });
    }

    const assignmentId = toObjectId(req.params.assignmentId);
    if (!assignmentId) {
      return res.status(400).json({ message: "Invalid assignmentId" });
    }

    const assignment = draft.assignments.find(
      (item) => item.assignmentId.toString() === assignmentId.toString(),
    );

    if (!assignment) {
      return res.status(404).json({ message: "Draft assignment not found" });
    }

    if (assignment.state === "published" || assignment.publishedScheduleId) {
      return res.status(400).json({
        message: "Published draft assignments cannot be refilled with AI",
      });
    }

    if (!assignment.startTime || !assignment.endTime) {
      return res.status(400).json({
        message: "Assignment is missing startTime or endTime",
      });
    }

    const coverageTarget = {
      _id: assignment.coverageId || assignment.assignmentId,
      role: assignment.role,
      unitArea: assignment.unitArea || null,
      shiftType: assignment.shiftType || null,
      shiftTag: assignment.shiftTag || null,
      requiredCertificationTags: assignment.certificationTags || [],
      startTime: new Date(assignment.startTime),
      endTime: new Date(assignment.endTime),
      date: new Date(assignment.startTime),
    };

    const coverageMinutes = minutesBetween(
      coverageTarget.startTime,
      coverageTarget.endTime,
    );

    if (!Number.isFinite(coverageMinutes) || coverageMinutes <= 0) {
      return res.status(400).json({
        message: "Assignment has an invalid time window",
      });
    }

    const tenantId = req.tenantId;
    const facilityPreferences = await FacilityPreferences.findOne({
      tenantId,
    }).lean();
    const facilityPolicy = getEffectiveFacilityPolicy(facilityPreferences);
    const facilityConfig = getCompatibleFacilityConfig(facilityPreferences);
    const facilityTimezone = normalizeZone(
      facilityPreferences?.facilityTimezone,
    );

    if (!isEnabledScheduleRole(coverageTarget.role, facilityConfig)) {
      return res.status(400).json({
        message: `invalid role '${coverageTarget.role || ""}'`,
      });
    }

    const targetStart = new Date(coverageTarget.startTime);
    const targetEnd = new Date(coverageTarget.endTime);

    const fairnessWindowStart = new Date(targetStart);
    fairnessWindowStart.setUTCDate(
      fairnessWindowStart.getUTCDate() - facilityPolicy.fairnessLookbackDays,
    );
    const firstCoverageWeekStart = getWeekStart(targetStart, facilityTimezone);
    const lastCoverageWeekStart = getWeekStart(targetEnd, facilityTimezone);
    const weeklyWindowEnd = new Date(lastCoverageWeekStart);
    weeklyWindowEnd.setUTCDate(weeklyWindowEnd.getUTCDate() + 7);

    const [timeOffDocs, existingSchedules, fairnessSchedules, tenantUsers] =
      await Promise.all([
        TimeOff.find({
          tenantId,
          status: "approved",
          startTime: { $lte: targetEnd },
          endTime: { $gte: targetStart },
        }),
        Schedule.find({
          tenantId,
          status: { $nin: ["completed", "left_early", "no_show", "cancelled"] },
          startTime: { $lt: targetEnd },
          endTime: { $gt: targetStart },
        }),
        Schedule.find({
          tenantId,
          status: { $in: ["scheduled", "completed"] },
          startTime: { $lte: targetEnd },
          endTime: { $gte: fairnessWindowStart },
        }).select("staffId startTime endTime"),
        User.find({ tenantId, loginEnabled: false, status: "active" }).select(
          "name email role roles allowedAreas allowedShiftTypes certificationTags userPhone userPhoneCountryCode",
        ),
      ]);

    const timeOffMap = {};
    timeOffDocs.forEach((timeOff) => {
      const staffId = timeOff.staffId && timeOff.staffId.toString();
      if (!staffId) return;
      if (!timeOffMap[staffId]) timeOffMap[staffId] = [];
      timeOffMap[staffId].push(timeOff);
    });

    const existingByStaff = {};
    existingSchedules.forEach((schedule) => {
      const staffId = schedule.staffId && schedule.staffId.toString();
      if (!staffId) return;
      if (!existingByStaff[staffId]) existingByStaff[staffId] = [];
      existingByStaff[staffId].push(schedule);
    });

    const recentWorkload = {};
    const weeklyWorkload = {};
    const weekendShiftCounts = {};
    const nightShiftCounts = {};
    const staffAssignedDaySets = {};
    const trackedScheduleKeys = new Set();

    fairnessSchedules.forEach((schedule) => {
      const staffId = schedule.staffId.toString();
      const minutes = minutesBetween(schedule.startTime, schedule.endTime);

      recentWorkload[staffId] = (recentWorkload[staffId] || 0) + minutes;

      const scheduleWeekStart = getWeekStart(
        schedule.startTime,
        facilityTimezone,
      );
      if (
        scheduleWeekStart >= firstCoverageWeekStart &&
        scheduleWeekStart < weeklyWindowEnd
      ) {
        const key = buildWeekKey(staffId, schedule.startTime, facilityTimezone);
        weeklyWorkload[key] = (weeklyWorkload[key] || 0) + minutes;
      }

      addTrackedSchedule({
        schedule,
        trackedKeys: trackedScheduleKeys,
        staffAssignedDaySets,
        weekendShiftCounts,
        nightShiftCounts,
        timezone: facilityTimezone,
      });
    });

    existingSchedules.forEach((schedule) => {
      addTrackedSchedule({
        schedule,
        trackedKeys: trackedScheduleKeys,
        staffAssignedDaySets,
        weekendShiftCounts,
        nightShiftCounts,
        timezone: facilityTimezone,
      });
    });

    const syntheticDraftSchedules = draft.assignments
      .filter(
        (item) =>
          item.assignmentId.toString() !== assignment.assignmentId.toString() &&
          item.staffId &&
          ["proposed", "locked", "published"].includes(item.state),
      )
      .map((item) => ({
        staffId: item.staffId,
        startTime: item.startTime,
        endTime: item.endTime,
        status: item.state === "published" ? "scheduled" : "draft",
      }));

    syntheticDraftSchedules.forEach((schedule) => {
      const staffId = schedule.staffId.toString();
      if (!existingByStaff[staffId]) existingByStaff[staffId] = [];
      existingByStaff[staffId].push(schedule);

      const minutes = minutesBetween(schedule.startTime, schedule.endTime);
      recentWorkload[staffId] = (recentWorkload[staffId] || 0) + minutes;

      const scheduleWeekStart = getWeekStart(
        schedule.startTime,
        facilityTimezone,
      );
      if (
        scheduleWeekStart >= firstCoverageWeekStart &&
        scheduleWeekStart < weeklyWindowEnd
      ) {
        const weekKey = buildWeekKey(
          staffId,
          schedule.startTime,
          facilityTimezone,
        );
        weeklyWorkload[weekKey] = (weeklyWorkload[weekKey] || 0) + minutes;
      }

      addTrackedSchedule({
        schedule,
        trackedKeys: trackedScheduleKeys,
        staffAssignedDaySets,
        weekendShiftCounts,
        nightShiftCounts,
        timezone: facilityTimezone,
      });
    });

    const roleStaff = tenantUsers.filter((staff) =>
      isStaffCompatibleWithCoverage({
        staff,
        coverage: coverageTarget,
        facilityConfig,
      }),
    );

    if (!roleStaff.length) {
      return res.status(409).json({
        message:
          "No staff found with a compatible role, area, shift type, and certification profile.",
        reasonCode: "NO_STAFF_FOR_ROLE",
        skippedByReason: {},
        candidateCount: 0,
        availableCount: 0,
      });
    }

    const staffIds = roleStaff.map((staff) => staff._id.toString());
    const preferences = await Preferences.find({
      tenantId,
      staffId: { $in: staffIds },
    });

    const preferenceMap = {};
    preferences.forEach((preference) => {
      preferenceMap[preference.staffId.toString()] = preference;
    });

    const skippedByReason = {};
    const available = [];

    for (const staff of roleStaff) {
      const staffId = staff._id.toString();
      const currentSchedules = existingByStaff[staffId] || [];
      let skipReason = null;

      if (
        currentSchedules.some(
          (schedule) =>
            schedule.status === "call_out" &&
            schedule.startTime.getTime() === targetStart.getTime() &&
            schedule.endTime.getTime() === targetEnd.getTime(),
        )
      ) {
        skipReason = "called out for this shift";
      } else if (
        timeOffMap[staffId]?.some((timeOff) => {
          const timeOffStart = new Date(timeOff.startTime);
          const timeOffEnd = new Date(timeOff.endTime);
          return timeOffStart <= targetEnd && timeOffEnd >= targetStart;
        })
      ) {
        skipReason = "has approved time off overlapping coverage";
      } else if (
        currentSchedules.some(
          (schedule) =>
            schedule.status !== "call_out" &&
            !(
              schedule.endTime <= targetStart || schedule.startTime >= targetEnd
            ),
        )
      ) {
        skipReason = "already scheduled for overlapping shift";
      }

      if (skipReason) {
        skippedByReason[skipReason] = (skippedByReason[skipReason] || 0) + 1;
      } else {
        available.push(staff);
      }
    }

    if (!available.length) {
      return res.status(409).json({
        message:
          "No eligible staff available due to conflicts, time off, call out, availability preferences, or break constraints.",
        reasonCode: "NO_AVAILABLE_STAFF",
        skippedByReason,
        candidateCount: roleStaff.length,
        availableCount: 0,
      });
    }

    const rankedCandidates = available
      .map((staff) => {
        const staffId = staff._id.toString();
        return {
          staff,
          metrics: buildRankingMetrics({
            staff,
            staffId,
            coverage: coverageTarget,
            coverageMinutes,
            coverageId: coverageTarget._id,
            facilityPolicy,
            facilityConfig,
            staffPreferences: preferenceMap[staffId],
            weeklyWorkload,
            recentWorkload,
            weekendShiftCounts,
            nightShiftCounts,
            staffAssignedDaySets,
            timezone: facilityTimezone,
          }),
        };
      })
      .sort((a, b) => compareRankingMetrics(a.metrics, b.metrics));

    const selected = rankedCandidates[0];
    if (!selected) {
      return res.status(409).json({
        message:
          "No eligible staff remained after ranking and conflict checks.",
        reasonCode: "INSUFFICIENT_CANDIDATES",
        skippedByReason,
        candidateCount: roleStaff.length,
        availableCount: available.length,
      });
    }

    assignment.staffId = selected.staff._id;
    assignment.state = "proposed";
    assignment.source = "auto";
    assignment.unfilledReason = null;
    assignment.warnings = {
      overtimeMinutes: selected.metrics.overtimeMinutes || 0,
      consecutiveDaysIfAssigned:
        selected.metrics.consecutiveDaysIfAssigned || 0,
      patternPenalty: selected.metrics.patternPenalty || 0,
      weekendShiftCount: selected.metrics.weekendShiftCount || 0,
      nightShiftCount: selected.metrics.nightShiftCount || 0,
      projectedWeekMinutes: selected.metrics.projectedWeekMinutes || 0,
      preferencePenalty: selected.metrics.preferencePenalty || 0,
    };

    draft.lastEditedBy = req.user._id;
    await draft.save();

    const updatedAssignment = draft.assignments.find(
      (item) =>
        item.assignmentId.toString() === assignment.assignmentId.toString(),
    );

    return res.json({
      message: "Draft assignment filled with AI",
      assignment: updatedAssignment,
      slotCounts: buildDraftStateCounts(draft.assignments || []),
    });
  } catch (err) {
    return next(err);
  }
};

exports.publishAutoScheduleDraft = async (req, res, next) => {
  try {
    const draft = await ensureDraftSchedule({
      draftId: req.params.draftId,
      tenantId: req.tenantId,
    });

    if (!draft) {
      return res.status(404).json({ message: "Draft schedule not found" });
    }

    const { assignmentIds } = req.body || {};
    const selectedIdSet = Array.isArray(assignmentIds)
      ? new Set(assignmentIds.map((value) => String(value)))
      : null;

    const assignments = draft.assignments.filter((item) => {
      if (!["proposed", "locked"].includes(item.state)) return false;
      if (item.publishedScheduleId) return false;
      if (!selectedIdSet) return true;
      return selectedIdSet.has(item.assignmentId.toString());
    });

    if (!assignments.length) {
      return res.status(400).json({
        message: "Draft schedule has no publishable assignments",
      });
    }

    const blocked = [];
    for (const assignment of assignments) {
      if (!assignment.staffId) {
        blocked.push({
          assignmentId: assignment.assignmentId,
          staffId: null,
          conflict: { message: "Draft assignment has no staff assigned" },
        });
        continue;
      }

      const conflict = await hasConflict({
        tenantId: req.tenantId,
        staffId: assignment.staffId,
        startTime: assignment.startTime,
        endTime: assignment.endTime,
      });

      if (conflict) {
        blocked.push({
          assignmentId: assignment.assignmentId,
          staffId: assignment.staffId,
          conflict,
        });
      }
    }

    if (blocked.length) {
      return res.status(409).json({
        message: "Draft schedule has conflicts and cannot be published",
        blocked,
      });
    }

    // "Publishing" an auto-fill draft puts the shifts on the schedule. They
    // stay drafts (silent) unless their week has already been published.
    const states = [];
    for (const assignment of assignments) {
      states.push(
        await stateForNewSchedule({
          tenantId: req.tenantId,
          startTime: assignment.startTime,
        }),
      );
    }

    const schedulePayload = assignments.map((assignment, index) => ({
      state: states[index],
      tenantId: req.tenantId,
      staffId: assignment.staffId,
      coverageId: assignment.coverageId || null,
      role: assignment.role,
      unitArea: assignment.unitArea,
      shiftType: assignment.shiftType,
      shiftTag: assignment.shiftTag,
      certificationTags: assignment.certificationTags,
      startTime: assignment.startTime,
      endTime: assignment.endTime,
      timezone: assignment.timezone || "UTC",
      notes: assignment.notes || "Auto-generated",
      status: "scheduled",
      meta: {
        createdBy: req.user._id,
        source: "auto",
        ...(states[index] === "published" ? { publishedAt: new Date() } : {}),
      },
    }));

    const createdSchedules = await Schedule.insertMany(schedulePayload, {
      ordered: true,
    });

    assignments.forEach((assignment, index) => {
      assignment.publishedScheduleId = createdSchedules[index]._id;
      assignment.state = "published";
    });

    const remainingUnpublished = draft.assignments.filter(
      (item) =>
        ["proposed", "locked"].includes(item.state) &&
        !item.publishedScheduleId,
    ).length;

    draft.status = remainingUnpublished ? "partially_published" : "published";
    draft.publishedAt = new Date();
    draft.publishedBy = req.user._id;
    draft.lastEditedBy = req.user._id;
    await draft.save();

    const slotCounts = buildDraftStateCounts(draft.assignments || []);

    res.json({
      message: "Draft schedule published to schedule",
      draftId: draft._id,
      publishedCount: createdSchedules.length,
      scheduleIds: createdSchedules.map((schedule) => schedule._id),
      draftStatus: draft.status,
      remainingUnfilledSlots: slotCounts.unfilledSlots,
      slotCounts,
    });
  } catch (err) {
    next(err);
  }
};

exports.discardAutoScheduleDraft = async (req, res, next) => {
  try {
    const draft = await ensureDraftSchedule({
      draftId: req.params.draftId,
      tenantId: req.tenantId,
    });

    if (!draft) {
      return res.status(404).json({ message: "Draft schedule not found" });
    }

    draft.status = "discarded";
    draft.discardedAt = new Date();
    draft.discardedBy = req.user._id;
    draft.lastEditedBy = req.user._id;
    draft.assignments.forEach((assignment) => {
      if (!assignment.publishedScheduleId) {
        assignment.state = "removed";
      }
    });
    await draft.save();

    res.json({
      message: "Draft schedule discarded",
      draftId: draft._id,
      status: draft.status,
    });
  } catch (err) {
    next(err);
  }
};

// REQUEST SHIFT SWAP (same role only)
exports.requestShiftSwap = async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const { receiverStaffId, note } = req.body;

    if (!receiverStaffId) {
      return res.status(400).json({ message: "receiverStaffId is required" });
    }

    const schedule = await Schedule.findOne({
      _id: scheduleId,
      tenantId: req.tenantId,
    });

    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    if (schedule.status !== "scheduled") {
      return res.status(400).json({
        message: "Only scheduled shifts can be swapped",
      });
    }

    const requesterId = schedule.staffId.toString();
    const actorId = req.user._id.toString();

    if (
      !hasPermission(req.user, "schedule.manage") &&
      actorId !== requesterId
    ) {
      return res.status(403).json({
        message: "Only the assigned staff member (or admin) can request a swap",
      });
    }

    if (requesterId === String(receiverStaffId)) {
      return res.status(400).json({
        message: "receiverStaffId must be different from current staffId",
      });
    }

    const [requester, receiver, facilityPreferences] = await Promise.all([
      User.findOne({ _id: schedule.staffId, tenantId: req.tenantId }),
      User.findOne({
        _id: receiverStaffId,
        tenantId: req.tenantId,
        loginEnabled: false,
        status: "active",
      }),
      FacilityPreferences.findOne({ tenantId: req.tenantId }).lean(),
    ]);

    if (!requester || !receiver) {
      return res
        .status(404)
        .json({ message: "Requester or receiver staff not found" });
    }

    const facilityConfig = getCompatibleFacilityConfig(facilityPreferences);
    if (!isStaffRoleCompatible(receiver, schedule.role, facilityConfig)) {
      return res.status(400).json({
        message:
          "Shift swap is allowed only between staff with a compatible role",
      });
    }

    const conflict = await hasConflict({
      tenantId: req.tenantId,
      staffId: receiver._id,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    });

    if (conflict) {
      return res.status(409).json({
        message: "Receiver has a conflicting schedule in this time slot",
        conflict,
      });
    }

    const pendingExisting = await ShiftSwap.findOne({
      tenantId: req.tenantId,
      scheduleId: schedule._id,
      receiverStaffId: receiver._id,
      status: { $in: ["pending_admin", "pending_receiver"] },
    });

    if (pendingExisting) {
      return res.status(409).json({
        message: "A pending swap request already exists for this receiver",
      });
    }

    const swapRequest = await ShiftSwap.create({
      tenantId: req.tenantId,
      scheduleId: schedule._id,
      requesterStaffId: requester._id,
      receiverStaffId: receiver._id,
      role: schedule.role,
      shiftStartTime: schedule.startTime,
      shiftEndTime: schedule.endTime,
      requestNote: note || "",
      status: "pending_admin",
    });

    const admins = await getTenantAdmins(req.tenantId, [
      requester._id,
      receiver._id,
    ]);
    const recipients = [receiver, requester, ...admins];
    const facilityTimezone = await getFacilityTimezone(req.tenantId);
    const shiftWindow = formatRangeInFacilityZone(
      schedule.startTime,
      schedule.endTime,
      facilityTimezone,
    );

    await notifyUsersBestEffort({
      tenantId: req.tenantId,
      users: recipients,
      emailSubject: "Shift swap request",
      emailHtml: (user) => `
        <p>Hi ${user.name || "team member"},</p>
        <p>${requester.name || "A staff member"} requested a shift swap.</p>
        <ul>
          <li><strong>Role:</strong> ${schedule.role}</li>
          <li><strong>Current staff:</strong> ${requester.name || requester.email || requester._id}</li>
          <li><strong>Requested receiver:</strong> ${receiver.name || receiver.email || receiver._id}</li>
          <li><strong>Shift:</strong> ${shiftWindow}</li>
          <li><strong>Status:</strong> pending admin approval</li>
        </ul>
        ${note ? `<p><strong>Note:</strong> ${escapeHtml(note)}</p>` : ""}
      `,
      smsBody: () =>
        `Shift swap requested: ${schedule.role}, ${shiftWindow}. Awaiting admin approval before receiver response.`,
    });

    const populated = await ShiftSwap.findById(swapRequest._id)
      .populate("requesterStaffId", "name email role")
      .populate("receiverStaffId", "name email role")
      .populate("scheduleId", "role startTime endTime status");

    res.status(201).json({
      message: "Shift swap request submitted and sent for admin approval",
      swapRequest: populated,
    });
  } catch (err) {
    next(err);
  }
};

// LIST SHIFT SWAP REQUESTS
exports.getShiftSwapRequests = async (req, res, next) => {
  try {
    const { status, view = "all" } = req.query;
    const filter = { tenantId: req.tenantId };

    if (status) {
      filter.status = status;
    }

    if (!hasPermission(req.user, "schedule.manage")) {
      filter.$or = [
        { requesterStaffId: req.user._id },
        { receiverStaffId: req.user._id },
      ];

      if (view === "inbox") {
        delete filter.$or;
        filter.receiverStaffId = req.user._id;
      }

      if (view === "outbox") {
        delete filter.$or;
        filter.requesterStaffId = req.user._id;
      }
    }

    const requests = await ShiftSwap.find(filter)
      .populate("requesterStaffId", "name email role")
      .populate("receiverStaffId", "name email role")
      .populate("scheduleId", "role startTime endTime status staffId")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    next(err);
  }
};

// ACCEPT OR DENY SHIFT SWAP REQUEST
exports.respondToShiftSwapRequest = async (req, res, next) => {
  try {
    const { decision, responseNote } = req.body;
    const normalizedDecision = String(decision || "").toLowerCase();

    const swapRequest = await ShiftSwap.findOne({
      _id: req.params.swapRequestId,
      tenantId: req.tenantId,
    });

    if (!swapRequest) {
      return res.status(404).json({ message: "Swap request not found" });
    }

    const schedule = await Schedule.findOne({
      _id: swapRequest.scheduleId,
      tenantId: req.tenantId,
    });

    if (!schedule) {
      return res.status(404).json({ message: "Original schedule not found" });
    }

    const [requester, receiver] = await Promise.all([
      User.findOne({
        _id: swapRequest.requesterStaffId,
        tenantId: req.tenantId,
      }),
      User.findOne({
        _id: swapRequest.receiverStaffId,
        tenantId: req.tenantId,
      }),
    ]);

    if (!requester || !receiver) {
      return res
        .status(404)
        .json({ message: "Requester or receiver staff not found" });
    }

    const admins = await getTenantAdmins(req.tenantId, [
      requester._id,
      receiver._id,
    ]);
    const shiftWindow = formatRangeInFacilityZone(
      swapRequest.shiftStartTime,
      swapRequest.shiftEndTime,
      await getFacilityTimezone(req.tenantId),
    );
    let decisionWord = "";
    let scheduleUpdated = false;

    if (swapRequest.status === "pending_admin") {
      if (!hasPermission(req.user, "schedule.manage")) {
        return res.status(403).json({
          message:
            "Only admins can approve or deny swap requests at this stage",
        });
      }

      if (!["approve", "deny"].includes(normalizedDecision)) {
        return res
          .status(400)
          .json({ message: "decision must be either 'approve' or 'deny'" });
      }

      if (normalizedDecision === "approve") {
        swapRequest.status = "pending_receiver";
        decisionWord = "approved by admin";
      } else {
        swapRequest.status = "admin_denied";
        decisionWord = "denied by admin";
      }

      swapRequest.responseNote = responseNote || "";
      swapRequest.respondedAt = new Date();
      swapRequest.resolvedBy = req.user._id;
      await swapRequest.save();

      const recipients = [requester, receiver, ...admins];
      await notifyUsersBestEffort({
        tenantId: req.tenantId,
        users: recipients,
        emailSubject: `Shift swap ${decisionWord}`,
        emailHtml: (user) => `
          <p>Hi ${user.name || "team member"},</p>
          <p>The shift swap request has been <strong>${decisionWord}</strong>.</p>
          <ul>
            <li><strong>Role:</strong> ${swapRequest.role}</li>
            <li><strong>Requester:</strong> ${requester.name || requester.email || requester._id}</li>
            <li><strong>Receiver:</strong> ${receiver.name || receiver.email || receiver._id}</li>
            <li><strong>Shift:</strong> ${shiftWindow}</li>
            <li><strong>Status:</strong> ${swapRequest.status}</li>
          </ul>
          ${responseNote ? `<p><strong>Response note:</strong> ${escapeHtml(responseNote)}</p>` : ""}
        `,
        smsBody: () =>
          `Shift swap ${decisionWord}: ${swapRequest.role}, ${shiftWindow}.`,
      });
    } else if (swapRequest.status === "pending_receiver") {
      const isReceiver =
        swapRequest.receiverStaffId.toString() === req.user._id.toString();
      if (!isReceiver && !hasPermission(req.user, "schedule.manage")) {
        return res.status(403).json({
          message:
            "Only the receiving staff member (or admin) can accept or deny at this stage",
        });
      }

      if (!["accept", "deny"].includes(normalizedDecision)) {
        return res
          .status(400)
          .json({ message: "decision must be either 'accept' or 'deny'" });
      }

      if (normalizedDecision === "accept") {
        if (schedule.staffId.toString() !== requester._id.toString()) {
          return res.status(409).json({
            message:
              "This shift is no longer assigned to the original requester; swap cannot be completed",
          });
        }

        if (schedule.status !== "scheduled") {
          return res.status(409).json({
            message: "This shift is no longer scheduled; swap cannot be completed",
          });
        }

        const swapFacilityPrefs = await FacilityPreferences.findOne({
          tenantId: req.tenantId,
        }).lean();
        if (
          !isStaffRoleCompatible(
            receiver,
            schedule.role,
            getCompatibleFacilityConfig(swapFacilityPrefs),
          )
        ) {
          return res.status(400).json({
            message:
              "Swap cannot be accepted because receiver no longer has a compatible role for this shift",
          });
        }

        const conflict = await hasConflict({
          tenantId: req.tenantId,
          staffId: receiver._id,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        });

        if (conflict) {
          return res.status(409).json({
            message:
              "Receiver now has a conflicting schedule in this time slot",
            conflict,
          });
        }

        schedule.staffId = receiver._id;
        const swapAudit = `Shift swapped from ${requester.name || requester._id} to ${receiver.name || receiver._id} on ${new Date().toUTCString()}`;
        schedule.notes = schedule.notes
          ? `${schedule.notes}\n${swapAudit}`
          : swapAudit;
        await schedule.save();

        swapRequest.status = "accepted";
        scheduleUpdated = true;
      } else {
        swapRequest.status = "denied";
      }

      swapRequest.responseNote = responseNote || "";
      swapRequest.respondedAt = new Date();
      swapRequest.resolvedBy = req.user._id;
      await swapRequest.save();

      decisionWord = normalizedDecision === "accept" ? "accepted" : "denied";
      const recipients = [requester, receiver, ...admins];
      await notifyUsersBestEffort({
        tenantId: req.tenantId,
        users: recipients,
        emailSubject: `Shift swap ${decisionWord}`,
        emailHtml: (user) => `
          <p>Hi ${user.name || "team member"},</p>
          <p>The shift swap request has been <strong>${decisionWord}</strong>.</p>
          <ul>
            <li><strong>Role:</strong> ${swapRequest.role}</li>
            <li><strong>Requester:</strong> ${requester.name || requester.email || requester._id}</li>
            <li><strong>Receiver:</strong> ${receiver.name || receiver.email || receiver._id}</li>
            <li><strong>Shift:</strong> ${shiftWindow}</li>
            <li><strong>Decision:</strong> ${decisionWord}</li>
          </ul>
          ${responseNote ? `<p><strong>Response note:</strong> ${escapeHtml(responseNote)}</p>` : ""}
        `,
        smsBody: () =>
          `Shift swap ${decisionWord}: ${swapRequest.role}, ${shiftWindow}.`,
      });
    } else {
      return res
        .status(400)
        .json({ message: `Swap request is already ${swapRequest.status}` });
    }

    const populated = await ShiftSwap.findById(swapRequest._id)
      .populate("requesterStaffId", "name email role")
      .populate("receiverStaffId", "name email role")
      .populate("scheduleId", "role startTime endTime status staffId notes");

    res.json({
      message: `Shift swap ${decisionWord}`,
      swapRequest: populated,
      scheduleUpdated,
    });
  } catch (err) {
    next(err);
  }
};

// CREATE SCHEDULE
exports.createSchedule = async (req, res, next) => {
  try {
    const {
      staffId,
      role,
      coverageId,
      unitArea,
      shiftType,
      shiftTag,
      certificationTags,
      startTime,
      endTime,
      notes,
      timezone,
    } = req.body;

    if (!staffId || !role || !startTime || !endTime)
      return res.status(400).json({
        message: "staffId, role, startTime, endTime are required",
      });

    if (coverageId && !mongoose.isValidObjectId(coverageId)) {
      return res.status(400).json({ message: "Invalid coverageId" });
    }

    const linkedCoverage = coverageId
      ? await Coverage.findOne({
          _id: coverageId,
          tenantId: req.tenantId,
        }).select("_id")
      : null;

    if (coverageId && !linkedCoverage) {
      return res.status(404).json({ message: "Coverage not found" });
    }

    const staff = await User.findOne({
      _id: staffId,
      tenantId: req.tenantId,
      loginEnabled: false,
      status: "active",
    }).select(
      "role roles allowedAreas allowedShiftTypes certificationTags name email userPhone userPhoneCountryCode",
    );

    if (!staff) {
      return res.status(404).json({ message: "Staff not found" });
    }

    const facilityPreferences = await FacilityPreferences.findOne({
      tenantId: req.tenantId,
    }).lean();
    const facilityConfig = getCompatibleFacilityConfig(facilityPreferences);

    const schedulePayload = {
      role: normalizeRoleFamily(role),
      unitArea: normalizeAreaTag(unitArea) || null,
      shiftType: normalizeShiftType(
        shiftType || inferShiftTypeFromWindow(startTime, endTime),
      ),
      shiftTag: normalizeShiftTag(shiftTag) || null,
      certificationTags: Array.isArray(certificationTags)
        ? certificationTags
        : [],
    };

    if (!isEnabledScheduleRole(schedulePayload.role, facilityConfig)) {
      return res.status(400).json({
        message: `invalid role '${role || ""}'`,
      });
    }

    if (!isStaffRoleCompatible(staff, schedulePayload.role, facilityConfig)) {
      return res.status(400).json({
        message: "Staff role is not compatible with the scheduled role",
      });
    }

    if (
      !isAreaCompatible(
        getStaffAllowedAreas(staff, facilityConfig.areas),
        schedulePayload.unitArea,
        getStaffExplicitAreas(staff).length > 0,
      )
    ) {
      return res.status(400).json({
        message: "Staff is not allowed to work this unit/area",
      });
    }

    if (
      !isShiftTypeCompatible(
        getStaffAllowedShiftTypes(staff, facilityConfig.shiftTypes),
        normalizeShiftType(schedulePayload.shiftType),
        normalizeShiftTag(schedulePayload.shiftTag),
        getStaffExplicitShiftTypes(staff).length > 0,
      )
    ) {
      return res.status(400).json({
        message: "Staff is not allowed to work this shift type",
      });
    }

    if (
      !isCertificationCompatible(
        dedupeStrings(schedulePayload.certificationTags),
        getStaffCertificationTags(staff),
      )
    ) {
      return res.status(400).json({
        message: "Staff does not have the required certification tags",
      });
    }

    // Check conflict
    const conflict = await hasConflict({
      tenantId: req.tenantId,
      staffId,
      startTime,
      endTime,
    });
    if (conflict)
      return res.status(409).json({ message: "Schedule conflict", conflict });

    let state = await stateForNewSchedule({
      tenantId: req.tenantId,
      startTime,
    });
    // Added to a published week: "Not sent yet" until Send, unless sendNow.
    if (state === "published" && !wantsSendNow(req)) state = "draft";

    const schedule = await Schedule.create({
      tenantId: req.tenantId,
      staffId,
      coverageId: linkedCoverage ? linkedCoverage._id : null,
      role: schedulePayload.role,
      unitArea: schedulePayload.unitArea,
      shiftType: schedulePayload.shiftType,
      shiftTag: schedulePayload.shiftTag,
      certificationTags: schedulePayload.certificationTags,
      startTime,
      endTime,
      notes,
      timezone: timezone || facilityPreferences?.facilityTimezone || "UTC",
      status: "scheduled",
      state,
      meta: { createdBy: req.user._id, source: "scheduler" },
    });

    // Drafts are silent; the person hears about them when the week is
    // published. Changes to a published week go out right away unless the
    // scheduler asked for a quiet edit (notify: false).
    if (state === "published" && req.body?.notify !== false) {
      await notifyShiftChange({
        req,
        staffId: schedule.staffId,
        kind: "shift_added",
        schedule,
      });
    }

    await autoRemoveDraftAssignmentForSchedule({
      tenantId: req.tenantId,
      schedule,
    });

    res.status(201).json(schedule);
  } catch (err) {
    next(err);
  }
};

// LIST SCHEDULES
const SCHEDULE_STAFF_FIELDS =
  "name email role roles profilePicture userPhone userPhoneCountryCode allowedAreas allowedShiftTypes certificationTags";

exports.getSchedules = async (req, res, next) => {
  try {
    const {
      staffId,
      role,
      unitArea,
      shiftType,
      status,
      from,
      to,
      page,
      limit,
    } = req.query;

    const filter = { tenantId: req.tenantId };
    if (staffId) filter.staffId = staffId;
    if (role) filter.role = role;
    if (unitArea) filter.unitArea = normalizeAreaTag(unitArea);
    if (shiftType) filter.shiftType = normalizeShiftType(shiftType);
    if (status) filter.status = { $in: String(status).split(",") };

    if (from || to) {
      filter.$and = [];
      if (from) filter.$and.push({ endTime: { $gte: new Date(from) } });
      if (to) filter.$and.push({ startTime: { $lte: new Date(to) } });
    }

    const isPaginated = page !== undefined || limit !== undefined;

    if (!isPaginated) {
      const schedules = await Schedule.find(filter)
        .populate("staffId", SCHEDULE_STAFF_FIELDS)
        .sort({ startTime: 1 })
        .lean();

      return res.json(schedules);
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safePage = Math.max(Number(page) || 1, 1);

    const [schedules, total] = await Promise.all([
      Schedule.find(filter)
        .populate("staffId", SCHEDULE_STAFF_FIELDS)
        .sort({ startTime: 1 })
        .skip((safePage - 1) * safeLimit)
        .limit(safeLimit)
        .lean(),
      Schedule.countDocuments(filter),
    ]);

    res.json({
      data: schedules,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
        hasMore: safePage * safeLimit < total,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET ONE
exports.getScheduleById = async (req, res, next) => {
  try {
    const schedule = await Schedule.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    }).populate("staffId", "-passwordHash");

    if (!schedule)
      return res.status(404).json({ message: "Schedule not found" });

    res.json(schedule);
  } catch (err) {
    next(err);
  }
};

// UPDATE SCHEDULE
const SCHEDULE_EDITABLE_FIELDS = [
  "staffId",
  "role",
  "unitArea",
  "shiftType",
  "shiftTag",
  "certificationTags",
  "startTime",
  "endTime",
  "notes",
  "status",
  "coverageId",
];
const SCHEDULER_SETTABLE_STATUSES = new Set([
  "scheduled",
  "in_progress",
  "completed",
  "left_early",
  "no_show",
  "call_out",
]);

exports.updateSchedule = async (req, res, next) => {
  try {
    // Only known fields can change (tenantId, state, meta never).
    const updates = {};
    for (const key of SCHEDULE_EDITABLE_FIELDS) {
      if (req.body?.[key] !== undefined) updates[key] = req.body[key];
    }
    if (
      updates.status !== undefined &&
      !SCHEDULER_SETTABLE_STATUSES.has(String(updates.status))
    ) {
      return res.status(400).json({ message: "Invalid status" });
    }
    if (
      updates.coverageId !== undefined &&
      updates.coverageId !== null &&
      !(await Coverage.exists({
        _id: updates.coverageId,
        tenantId: req.tenantId,
      }))
    ) {
      return res.status(404).json({ message: "Coverage not found" });
    }

    const currentSchedule = await Schedule.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!currentSchedule)
      return res.status(404).json({ message: "Schedule not found" });

    const nextStaffId = updates.staffId || currentSchedule.staffId;
    const nextRole = updates.role || currentSchedule.role;
    const normalizedNextRole = normalizeRoleFamily(nextRole);
    const nextUnitArea =
      updates.unitArea !== undefined
        ? updates.unitArea
        : currentSchedule.unitArea;
    const nextShiftType =
      updates.shiftType !== undefined
        ? updates.shiftType
        : currentSchedule.shiftType ||
          inferShiftTypeFromWindow(
            updates.startTime !== undefined
              ? updates.startTime
              : currentSchedule.startTime,
            updates.endTime !== undefined
              ? updates.endTime
              : currentSchedule.endTime,
          );
    const nextShiftTag =
      updates.shiftTag !== undefined
        ? updates.shiftTag
        : currentSchedule.shiftTag;
    const nextCertificationTags = Array.isArray(updates.certificationTags)
      ? updates.certificationTags
      : currentSchedule.certificationTags || [];

    const staff = await User.findOne({
      _id: nextStaffId,
      tenantId: req.tenantId,
      loginEnabled: false,
      status: "active",
    }).select("role roles allowedAreas allowedShiftTypes certificationTags");

    if (!staff) {
      return res.status(404).json({ message: "Staff not found" });
    }

    const facilityPreferences = await FacilityPreferences.findOne({
      tenantId: req.tenantId,
    }).lean();
    const facilityConfig = getCompatibleFacilityConfig(facilityPreferences);

    if (!isEnabledScheduleRole(normalizedNextRole, facilityConfig)) {
      return res.status(400).json({
        message: `invalid role '${nextRole || ""}'`,
      });
    }

    if (!isStaffRoleCompatible(staff, normalizedNextRole, facilityConfig)) {
      return res.status(400).json({
        message: "Staff role is not compatible with this schedule role",
      });
    }

    if (
      !isAreaCompatible(
        getStaffAllowedAreas(staff, facilityConfig.areas),
        normalizeAreaTag(nextUnitArea),
        getStaffExplicitAreas(staff).length > 0,
      )
    ) {
      return res.status(400).json({
        message: "Staff is not allowed to work this unit/area",
      });
    }

    if (
      !isShiftTypeCompatible(
        getStaffAllowedShiftTypes(staff, facilityConfig.shiftTypes),
        normalizeShiftType(nextShiftType),
        normalizeShiftTag(nextShiftTag),
        getStaffExplicitShiftTypes(staff).length > 0,
      )
    ) {
      return res.status(400).json({
        message: "Staff is not allowed to work this shift type",
      });
    }

    if (
      !isCertificationCompatible(
        dedupeStrings(nextCertificationTags),
        getStaffCertificationTags(staff),
      )
    ) {
      return res.status(400).json({
        message: "Staff does not have the required certification tags",
      });
    }

    // If times change, check conflicts
    if (updates.startTime || updates.endTime || updates.staffId) {
      const startTime =
        updates.startTime !== undefined
          ? new Date(updates.startTime)
          : currentSchedule.startTime;

      const endTime =
        updates.endTime !== undefined
          ? new Date(updates.endTime)
          : currentSchedule.endTime;

      const staffId = updates.staffId || currentSchedule.staffId;

      const conflict = await hasConflict({
        tenantId: req.tenantId,
        staffId,
        startTime,
        endTime,
        excludeScheduleId: req.params.id,
      });

      if (conflict)
        return res.status(409).json({ message: "Schedule conflict", conflict });
    }

    // Moving a shift into another week takes on that week's state
    // (published week -> published; unpublished week -> silent draft).
    if (updates.startTime !== undefined) {
      updates.state = await stateForNewSchedule({
        tenantId: req.tenantId,
        startTime: updates.startTime,
      });
    }
    // Given to someone else in a published week: the new person sees it
    // when the change is sent (unless sendNow).
    if (
      updates.staffId &&
      String(updates.staffId) !== String(currentSchedule.staffId) &&
      (updates.state || currentSchedule.state) === "published" &&
      !wantsSendNow(req)
    ) {
      updates.state = "draft";
    }

    const updated = await Schedule.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      {
        ...updates,
        role: normalizedNextRole,
        unitArea: normalizeAreaTag(nextUnitArea) || null,
        shiftType: normalizeShiftType(nextShiftType) || null,
        shiftTag: normalizeShiftTag(nextShiftTag) || null,
        certificationTags: dedupeStrings(nextCertificationTags),
      },
      { new: true },
    ).populate("staffId", "-passwordHash");

    if (!updated)
      return res.status(404).json({ message: "Schedule not found" });

    // Published shift moved, re-timed or reassigned: tell whoever's affected.
    const staffChanged =
      String(currentSchedule.staffId) !== String(updated.staffId?._id || updated.staffId);
    const timeChanged =
      new Date(currentSchedule.startTime).getTime() !==
        new Date(updated.startTime).getTime() ||
      new Date(currentSchedule.endTime).getTime() !==
        new Date(updated.endTime).getTime();
    const wasVisible = currentSchedule.state === "published";
    const isVisible = updated.state === "published";
    const sendNow = wantsSendNow(req);
    if (
      wasVisible &&
      !sendNow &&
      req.body?.notify !== false &&
      new Date(updated.endTime) > new Date()
    ) {
      // Wait for "Send changes": remember who's affected.
      await markPendingChange({
        tenantId: req.tenantId,
        startTime: currentSchedule.startTime,
        staffIds: [currentSchedule.staffId, staffChanged ? updated.staffId : null],
      });
      if (
        new Date(updated.startTime).getTime() !== new Date(currentSchedule.startTime).getTime()
      ) {
        await markPendingChange({
          tenantId: req.tenantId,
          startTime: updated.startTime,
          staffIds: [updated.staffId],
        });
      }
    } else if (
      (wasVisible || isVisible) &&
      sendNow &&
      req.body?.notify !== false &&
      new Date(updated.endTime) > new Date()
    ) {
      if (wasVisible && !isVisible) {
        // Moved into a week staff can't see yet: it's gone from their view.
        await notifyShiftChange({
          req,
          staffId: currentSchedule.staffId,
          kind: "shift_removed",
          schedule: currentSchedule,
        });
      } else if (!wasVisible && isVisible) {
        await notifyShiftChange({
          req,
          staffId: updated.staffId?._id || updated.staffId,
          kind: "shift_added",
          schedule: updated,
        });
      } else if (staffChanged) {
        await notifyShiftChange({
          req,
          staffId: currentSchedule.staffId,
          kind: "shift_removed",
          schedule: currentSchedule,
        });
        await notifyShiftChange({
          req,
          staffId: updated.staffId?._id || updated.staffId,
          kind: "shift_added",
          schedule: updated,
        });
      } else if (timeChanged || updates.role !== undefined) {
        await notifyShiftChange({
          req,
          staffId: currentSchedule.staffId,
          kind: "shift_changed",
          schedule: updated,
        });
      }
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// UPDATE OWN SCHEDULE STATUS
exports.updateOwnScheduleStatus = async (req, res, next) => {
  try {
    const status = String(req.body?.status || "")
      .trim()
      .toLowerCase();

    if (!SELF_SERVICE_SCHEDULE_STATUSES.has(status)) {
      return res.status(400).json({
        message: "Staff may only set a shift status to scheduled or call_out",
      });
    }

    const schedule = await Schedule.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    if (schedule.staffId.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        message: "You can only update the status of your own shift",
      });
    }

    if (new Date(schedule.endTime) <= new Date()) {
      return res
        .status(400)
        .json({ message: "This shift has already ended" });
    }

    const callingOut = status === "call_out" && schedule.status !== "call_out";
    schedule.status = status;
    if (callingOut) {
      schedule.meta = schedule.meta || {};
      schedule.meta.calledOutAt = new Date();
      schedule.meta.callOutReason = String(req.body?.reason || "")
        .trim()
        .slice(0, 300);
    }
    await schedule.save();

    // Tell the schedulers right away so they can fill it.
    if (callingOut) {
      const timezone = await getFacilityTimezone(req.tenantId);
      const when = shortShift(schedule.startTime, schedule.endTime, timezone);
      const appUrl = String(process.env.FRONTEND_URL || "").replace(/\/+$/, "");
      await notifySchedulers({
        tenantId: req.tenantId,
        subject: `${req.user.name} called out: ${when}`,
        html: (person) => `
          <p>Hi ${escapeHtml(firstName(person.name))},</p>
          <p><strong>${escapeHtml(req.user.name)}</strong> can't make their ${escapeHtml(schedule.role)} shift on ${escapeHtml(when)}.</p>
          ${schedule.meta.callOutReason ? `<p>Reason: ${escapeHtml(schedule.meta.callOutReason)}</p>` : ""}
          ${appUrl ? `<p><a href="${appUrl}/callout/${schedule._id}">Find coverage</a></p>` : ""}`,
      });
    }

    await schedule.populate("staffId", "name roles");
    res.json(schedule);
  } catch (err) {
    next(err);
  }
};

// DELETE
exports.deleteSchedule = async (req, res, next) => {
  try {
    const deleted = await Schedule.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!deleted)
      return res.status(404).json({ message: "Schedule not found" });

    await restoreAutoRemovedDraftAssignment({
      tenantId: req.tenantId,
      schedule: deleted,
    });

    const removalCounts =
      deleted.state === "published" &&
      deleted.status === "scheduled" &&
      new Date(deleted.startTime) > new Date() &&
      req.body?.notify !== false &&
      req.query?.notify !== "false";
    if (removalCounts && !wantsSendNow(req)) {
      await markPendingChange({
        tenantId: req.tenantId,
        startTime: deleted.startTime,
        staffIds: [deleted.staffId],
      });
    } else if (removalCounts) {
      await notifyShiftChange({
        req,
        staffId: deleted.staffId,
        kind: "shift_removed",
        schedule: deleted,
      });
    }

    res.json({ message: "Schedule deleted" });
  } catch (err) {
    next(err);
  }
};

// DELETE multiple schedules by ids
exports.deleteSchedulesByIds = async (req, res, next) => {
  try {
    if (!hasPermission(req.user, "schedule.manage")) {
      return res.status(403).json({ message: "Admins only" });
    }

    const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
    if (!ids || !ids.length) {
      return res.status(400).json({
        message: "ids is required and must be a non-empty array",
      });
    }

    const uniqueIds = [...new Set(ids.map((id) => String(id).trim()))];
    const invalidIds = uniqueIds.filter((id) => !mongoose.isValidObjectId(id));

    if (invalidIds.length) {
      return res.status(400).json({
        message: "One or more ids are invalid",
        invalidIds,
      });
    }

    const existing = await Schedule.find({
      tenantId: req.tenantId,
      _id: { $in: uniqueIds },
    })
      .select("_id")
      .lean();

    const existingIdSet = new Set(existing.map((item) => String(item._id)));
    const notFoundIds = uniqueIds.filter((id) => !existingIdSet.has(id));

    const toNotify =
      req.body?.notify === false
        ? []
        : await Schedule.find({
            tenantId: req.tenantId,
            _id: { $in: existing.map((item) => item._id) },
            state: "published",
            status: "scheduled",
            startTime: { $gt: new Date() },
          }).lean();

    let deletedCount = 0;
    if (existing.length) {
      const deleteResult = await Schedule.deleteMany({
        tenantId: req.tenantId,
        _id: { $in: existing.map((item) => item._id) },
      });
      deletedCount = deleteResult.deletedCount || 0;
    }

    for (const removed of toNotify) {
      if (wantsSendNow(req)) {
        await notifyShiftChange({
          req,
          staffId: removed.staffId,
          kind: "shift_removed",
          schedule: removed,
        });
      } else {
        await markPendingChange({
          tenantId: req.tenantId,
          startTime: removed.startTime,
          staffIds: [removed.staffId],
        });
      }
    }

    return res.status(200).json({
      message: "Bulk delete completed",
      requestedCount: uniqueIds.length,
      deletedCount,
      notFoundCount: notFoundIds.length,
      notFoundIds,
    });
  } catch (err) {
    next(err);
  }
};

// Pure ranking helpers, exported for unit tests.
exports._scoring = {
  PREFERENCE_WEIGHTS,
  getRotationPenalty,
  getPreferencePenalty,
  compareRankingMetrics,
  getWeekdayIndex,
  getWeekStart,
  getDayKey,
  isWeekendDate,
  isNightShift,
};
