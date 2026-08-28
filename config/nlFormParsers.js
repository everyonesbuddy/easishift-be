const { DateTime } = require("luxon");

function dedupeStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function normalizeLower(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REPEAT_MODES = ["daily", "weekdays", "weekends", "custom"];
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
// Manual startTime/endTime within this many minutes of a configured slot's
// start/end still counts as a match, so small rounding drift in the model's
// output doesn't stop it from snapping to the tenant's real shift slot.
const SLOT_MATCH_TOLERANCE_MINUTES = 15;

function clockTimeToMinutes(value) {
  const match = HH_MM_PATTERN.test(String(value || ""))
    ? String(value).split(":")
    : null;
  if (!match) return null;
  return Number(match[0]) * 60 + Number(match[1]);
}

// Finds a configured shift slot whose start/end time matches (within
// tolerance) the manual startTime/endTime the model returned, so we don't
// depend on the model to name the shiftType/shiftTag itself.
function findMatchingSlot(shiftSlotsByType, startTime, endTime) {
  const startMinutes = clockTimeToMinutes(startTime);
  const endMinutes = clockTimeToMinutes(endTime);
  if (startMinutes === null || endMinutes === null) return null;

  for (const [shiftType, slots] of Object.entries(shiftSlotsByType)) {
    for (const slot of slots) {
      const slotStart = clockTimeToMinutes(slot.startLocalTime);
      const slotEnd = clockTimeToMinutes(slot.endLocalTime);
      if (slotStart === null || slotEnd === null) continue;

      if (
        Math.abs(slotStart - startMinutes) <= SLOT_MATCH_TOLERANCE_MINUTES &&
        Math.abs(slotEnd - endMinutes) <= SLOT_MATCH_TOLERANCE_MINUTES
      ) {
        return { shiftType, shiftTag: slot.tag };
      }
    }
  }

  return null;
}

// Deterministically snaps manual startTime/endTime to a configured
// shiftType/shiftTag when one lines up, instead of relying on the model to
// pick it correctly.
function normalizeCoverageDraft(draft, context) {
  if (!draft || !Array.isArray(draft.shifts)) return draft;

  const shifts = draft.shifts.map((shift) => {
    if (!shift || typeof shift !== "object") return shift;
    if (shift.shiftType || shift.shiftTag) return shift;

    const match = findMatchingSlot(
      context.shiftSlotsByType,
      shift.startTime,
      shift.endTime,
    );
    if (!match) return shift;

    return {
      ...shift,
      shiftType: match.shiftType,
      shiftTag: match.shiftTag,
      startTime: null,
      endTime: null,
    };
  });

  return { ...draft, shifts };
}

function parseCoverageCopyRequest(message) {
  if (typeof message !== "string") return null;

  const text = message.trim().toLowerCase();
  if (!text) return null;

  const dateRangeMatches = [
    /(?:copy|repeat|reuse|duplicate)\s+(?:coverage|staffing|shifts?)\s+from\s+(\d{4}-\d{2}-\d{2})\s+(?:to|through|into|for)\s+(\d{4}-\d{2}-\d{2})/i,
    /(?:copy|repeat|reuse|duplicate)\s+(?:coverage|staffing|shifts?)\s+from\s+(\d{4}-\d{2}-\d{2})\s*[-–]\s*(\d{4}-\d{2}-\d{2})/i,
  ];

  for (const pattern of dateRangeMatches) {
    const match = text.match(pattern);
    if (match) {
      return {
        kind: "coverage-copy",
        period: "date-range",
        sourceDate: match[1],
        targetDate: match[2],
        source: `from ${match[1]}`,
        target: `to ${match[2]}`,
      };
    }
  }

  const monthRangeMatches = [
    /(?:copy|repeat|reuse|duplicate)\s+(?:coverage|staffing|shifts?)\s+from\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:to|through|into|for)\s+(january|february|march|april|may|june|july|august|september|october|november|december)/i,
    /(?:copy|repeat|reuse|duplicate)\s+(?:coverage|staffing|shifts?)\s+from\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s*[-–]\s*(january|february|march|april|may|june|july|august|september|october|november|december)/i,
  ];

  for (const pattern of monthRangeMatches) {
    const match = text.match(pattern);
    if (match) {
      const sourceMonth = match[1].toLowerCase();
      const targetMonth = match[2].toLowerCase();
      return {
        kind: "coverage-copy",
        period: "month-range",
        sourceMonth,
        targetMonth,
        source: `from ${sourceMonth}`,
        target: `to ${targetMonth}`,
      };
    }
  }

  const weekRangeMatches = [
    /(?:copy|repeat|reuse|duplicate)\s+(?:coverage|staffing|shifts?)\s+from\s+(last|previous)\s+week\s+(?:to|through|into|for)\s+(this|next)\s+week/i,
    /(?:copy|repeat|reuse|duplicate)\s+(?:coverage|staffing|shifts?)\s+from\s+(last|previous)\s+week\s*[-–]\s*(this|next)\s+week/i,
  ];

  for (const pattern of weekRangeMatches) {
    const match = text.match(pattern);
    if (match) {
      return {
        kind: "coverage-copy",
        period: "week",
        source: `${match[1]} week`,
        target: `${match[2]} week`,
      };
    }
  }

  const generalWeekPatterns = [
    /(?:copy|repeat|reuse|duplicate)\s+(?:coverage|staffing|shifts?)\s+from\s+(?:last|previous)\s+week/i,
    /(?:copy|repeat|reuse|duplicate)\s+(?:coverage|staffing|shifts?)\s+from\s+(?:last|previous)\s+month/i,
  ];

  if (generalWeekPatterns.some((pattern) => pattern.test(text))) {
    const isMonth = /month/.test(text);
    return {
      kind: "coverage-copy",
      period: isMonth ? "month" : "week",
      source: isMonth ? "last month" : "last week",
      target: isMonth ? "this month" : "this week",
    };
  }

  return null;
}

function getMonthIndex(monthName) {
  const index = MONTH_NAMES.indexOf(
    String(monthName || "")
      .trim()
      .toLowerCase(),
  );
  return index === -1 ? null : index + 1;
}

function getMonthStartForTarget(monthName, referenceDate) {
  const monthIndex = getMonthIndex(monthName);
  if (monthIndex === null) return null;

  const dt = referenceDate || DateTime.local();
  let year = dt.year;
  const currentMonth = dt.month;
  if (monthIndex < currentMonth) year += 1;

  return DateTime.fromObject(
    { year, month: monthIndex, day: 1 },
    { zone: dt.zoneName || "UTC" },
  );
}

function toWeekdayIndex(dateLike, facilityTimezone) {
  if (!dateLike) return null;

  const dt = DateTime.fromISO(dateLike, { zone: facilityTimezone || "UTC" });
  if (!dt.isValid) return null;

  return dt.weekday % 7;
}

function buildCoverageCopyDraft(message, context, history) {
  const request = parseCoverageCopyRequest(message);
  if (!request) return null;

  const records = Array.isArray(history) ? history.filter(Boolean) : [];
  const sorted = [...records].sort((a, b) => {
    const aDate = new Date(a?.date || a?.startTime || 0).getTime();
    const bDate = new Date(b?.date || b?.startTime || 0).getTime();
    return bDate - aDate;
  });

  const referenceDate = DateTime.local().setZone(
    context?.facilityTimezone || "UTC",
  );

  let selected = sorted.slice(0, 30);
  let periodDays = request.period === "month" ? 30 : 7;
  let startDate = referenceDate.toISODate();

  if (request.period === "month-range") {
    const targetMonthStart = getMonthStartForTarget(
      request.targetMonth,
      referenceDate,
    );
    const sourceMonthStart = getMonthStartForTarget(
      request.sourceMonth,
      referenceDate,
    );

    if (!targetMonthStart || !sourceMonthStart) {
      return {
        shifts: [],
        datePattern: {
          startDate: referenceDate.toISODate(),
          horizonDays: 30,
          repeatMode: "custom",
        },
        unresolved: [
          "The requested month range couldn’t be mapped to a valid calendar date.",
        ],
      };
    }

    startDate = targetMonthStart.toISODate();
    periodDays = targetMonthStart.daysInMonth;
    selected = sorted.filter((entry) => {
      const dateValue = entry?.date || entry?.startTime;
      if (!dateValue) return false;
      const dt = DateTime.fromJSDate(new Date(dateValue), {
        zone: context?.facilityTimezone || "UTC",
      });
      return (
        dt.isValid &&
        dt.month === sourceMonthStart.month &&
        dt.year === sourceMonthStart.year
      );
    });

    if (!selected.length) {
      selected = sorted.slice(0, 30);
    }
  } else if (request.period === "month") {
    const monthStart = getMonthStartForTarget(
      DateTime.local()
        .setZone(context?.facilityTimezone || "UTC")
        .monthLong.toLowerCase(),
      referenceDate,
    );
    startDate = (monthStart || referenceDate).toISODate();
    periodDays = (monthStart || referenceDate).daysInMonth;
  }

  if (!selected.length) {
    return {
      shifts: [],
      datePattern: {
        startDate,
        horizonDays: periodDays,
        repeatMode:
          request.period === "month" || request.period === "month-range"
            ? "custom"
            : "weekdays",
      },
      unresolved: ["No recent coverage was provided to copy from."],
    };
  }

  const uniqueWeekdays = dedupeStrings(
    selected
      .map((entry) => {
        const dateKey = entry?.date || entry?.startTime;
        const weekday = toWeekdayIndex(dateKey, context?.facilityTimezone);
        return weekday === null || weekday === undefined
          ? null
          : String(weekday);
      })
      .filter(Boolean),
  ).map(Number);

  const repeatMode =
    uniqueWeekdays.length === 5 &&
    uniqueWeekdays.every((day) => day >= 1 && day <= 5)
      ? "weekdays"
      : uniqueWeekdays.length === 2 &&
          uniqueWeekdays.every((day) => [0, 6].includes(day))
        ? "weekends"
        : "custom";

  const shifts = selected
    .map((entry) => {
      const role = String(entry?.role || "").trim();
      const unitArea = entry?.unitArea
        ? String(entry.unitArea).trim().toLowerCase()
        : null;
      const shiftType = entry?.shiftType
        ? String(entry.shiftType).trim()
        : null;
      const shiftTag = entry?.shiftTag ? String(entry.shiftTag).trim() : null;
      const requiredCount = Number.isInteger(entry?.requiredCount)
        ? entry.requiredCount
        : 1;

      const startTime = entry?.startTime
        ? DateTime.fromJSDate(new Date(entry.startTime), {
            zone: context?.facilityTimezone || "UTC",
          }).toFormat("HH:mm")
        : null;

      const endTime = entry?.endTime
        ? DateTime.fromJSDate(new Date(entry.endTime), {
            zone: context?.facilityTimezone || "UTC",
          }).toFormat("HH:mm")
        : null;

      const requiredCertificationTags = Array.isArray(
        entry?.requiredCertificationTags,
      )
        ? entry.requiredCertificationTags
            .map((tag) => String(tag || "").trim())
            .filter(Boolean)
        : [];

      return {
        role,
        unitArea,
        shiftType,
        shiftTag,
        requiredCount,
        requiredCertificationTags,
        startTime,
        endTime,
      };
    })
    .filter((shift) => shift.role);

  const draft = {
    shifts,
    datePattern: {
      startDate,
      horizonDays: periodDays,
      repeatMode,
      ...(repeatMode === "custom" && uniqueWeekdays.length
        ? { customWeekdays: uniqueWeekdays }
        : {}),
    },
    unresolved: [],
  };

  return draft;
}

// ─── coverage ───────────────────────────────────────────────────────────────

function buildCoverageContext(facilityPrefs) {
  const roleFamilies = dedupeStrings(facilityPrefs?.roleFamilies);
  const unitAreas = dedupeStrings(facilityPrefs?.unitAreas);
  const certificationTags = dedupeStrings(facilityPrefs?.certificationTags);
  const shiftTypeDefinitions = facilityPrefs?.shiftTypeDefinitions || [];

  const shiftTypeKeys = dedupeStrings(
    shiftTypeDefinitions.map((def) => def?.key),
  );

  // shiftType -> list of { tag, label, startLocalTime, endLocalTime }
  const shiftSlotsByType = {};
  for (const def of shiftTypeDefinitions) {
    const key = normalizeLower(def?.key);
    if (!key) continue;
    shiftSlotsByType[key] = (def?.timeSlots || []).map((slot) => ({
      tag: normalizeLower(slot?.tag),
      label: slot?.label || slot?.tag,
      startLocalTime: slot?.startLocalTime,
      endLocalTime: slot?.endLocalTime,
    }));
  }

  return {
    roleFamilies,
    unitAreas,
    certificationTags,
    shiftTypeKeys,
    shiftSlotsByType,
    facilityTimezone: facilityPrefs?.facilityTimezone || "UTC",
  };
}

function buildCoverageTool(context) {
  const allShiftTags = dedupeStrings(
    Object.values(context.shiftSlotsByType).flatMap((slots) =>
      slots.map((slot) => slot.tag),
    ),
  );

  return {
    name: "submit_coverage_draft",
    description:
      "Submit the structured coverage staffing request parsed from the admin's message.",
    input_schema: {
      type: "object",
      properties: {
        shifts: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              role: {
                type: "string",
                enum: context.roleFamilies.length
                  ? context.roleFamilies
                  : undefined,
                description:
                  "Must be one of the facility's configured role families",
              },
              unitArea: {
                type: ["string", "null"],
                description:
                  "Facility unit/area this coverage belongs to, or null if not mentioned",
              },
              shiftType: {
                type: ["string", "null"],
                description:
                  "One of the facility's configured shift types, or null when using a manual time window",
              },
              shiftTag: {
                type: ["string", "null"],
                description:
                  "A specific time slot tag under shiftType, or null when using a manual time window",
              },
              requiredCount: {
                type: "integer",
                minimum: 1,
                description: "How many staff are needed for this role/window",
              },
              requiredCertificationTags: {
                type: "array",
                items: { type: "string" },
              },
              startTime: {
                type: ["string", "null"],
                description:
                  "HH:MM 24-hour local facility time, only set when shiftType/shiftTag are null",
              },
              endTime: {
                type: ["string", "null"],
                description:
                  "HH:MM 24-hour local facility time, only set when shiftType/shiftTag are null",
              },
            },
            required: ["role", "requiredCount"],
          },
        },
        datePattern: {
          type: "object",
          properties: {
            startDate: {
              type: "string",
              description: "First date this coverage applies to, in YYYY-MM-DD",
            },
            horizonDays: {
              type: "integer",
              minimum: 1,
              maximum: 366,
              description:
                "Total number of calendar days the pattern spans, starting at startDate",
            },
            repeatMode: {
              type: "string",
              enum: REPEAT_MODES,
            },
            customWeekdays: {
              type: "array",
              items: { type: "integer", minimum: 0, maximum: 6 },
              description:
                "0=Sunday..6=Saturday, only used when repeatMode is 'custom'",
            },
          },
          required: ["startDate", "horizonDays", "repeatMode"],
        },
        unresolved: {
          type: "array",
          items: { type: "string" },
          description:
            "Plain-language notes about anything ambiguous or not mappable to the schema. Empty if fully resolved.",
        },
      },
      required: ["shifts", "datePattern"],
    },
  };
}

function buildCoverageSystemPrompt(context, todayInfo) {
  const shiftTypeSummary = Object.entries(context.shiftSlotsByType)
    .map(([key, slots]) => {
      const slotSummary = slots
        .map(
          (slot) => `${slot.tag} (${slot.startLocalTime}-${slot.endLocalTime})`,
        )
        .join(", ");
      return `- ${key}: ${slotSummary || "no configured time slots"}`;
    })
    .join("\n");

  return `You convert a scheduling admin's natural-language staffing request into a structured coverage draft.

Today is ${todayInfo.weekday}, ${todayInfo.isoDate} (facility timezone: ${context.facilityTimezone}).

Facility configuration you must respect:
- Valid roles: ${context.roleFamilies.join(", ") || "(none configured)"}
- Valid unit areas: ${context.unitAreas.join(", ") || "(none configured)"}
- Valid certification tags: ${context.certificationTags.join(", ") || "(none configured)"}
- Configured shift types and their time slots:
${shiftTypeSummary || "(no shift types configured)"}

Rules:
- Convert any 12-hour time mentioned in the request (e.g. "7am", "5pm") to 24-hour HH:MM before comparing it to the configured slots above.
- Always check the configured shift type time slots first: if the requested window's start and end time match (or are within about 15 minutes of) a configured slot's startLocalTime/endLocalTime, you MUST set that slot's shiftType/shiftTag and leave startTime/endTime null. Do not fall back to a manual window when a configured slot already covers the requested time range.
- Only set startTime/endTime (HH:MM, 24-hour, local facility time) when no configured slot reasonably matches the requested window, and leave shiftType/shiftTag null in that case.
- Never invent roles, unit areas, or certification tags that aren't in the facility configuration above. If something doesn't match, list it in "unresolved" instead of guessing.
- Resolve relative dates ("next Monday", "starting tomorrow") against today's date.
- "weekdays" means Mon-Fri, "weekends" means Sat-Sun; use repeatMode "custom" with customWeekdays only when the pattern doesn't fit daily/weekdays/weekends.
- Always call the submit_coverage_draft tool exactly once with your best-effort structured result.`;
}

// Every error carries a `path` (which field, for inline UI highlighting), a
// human `message`, and `allowedValues` when the problem is an invalid choice
// from a known list, so the client can show "did you mean one of: ...".
function addError(errors, path, message, allowedValues) {
  const error = { path, message };
  if (allowedValues) error.allowedValues = allowedValues;
  errors.push(error);
}

// Facility-level prerequisites the tenant must configure before coverage
// requests can be parsed at all. Checked before calling the model so a
// tenant that hasn't set up roles yet gets a clear, actionable message
// instead of a confusing downstream parse failure.
function describeCoverageConfigGaps(context) {
  const gaps = [];
  if (!context.roleFamilies.length) {
    gaps.push({
      field: "roleFamilies",
      message:
        "No roles are configured for this facility yet. Add at least one role in Facility Preferences before using AI staffing requests.",
    });
  }
  return gaps;
}

function validateCoverageDraft(draft, context) {
  const errors = [];
  const allowedRoles = new Set(context.roleFamilies.map(normalizeLower));
  const allowedUnitAreas = new Set(context.unitAreas.map(normalizeLower));
  const allowedCertTags = new Set(
    context.certificationTags.map(normalizeLower),
  );

  if (!draft || typeof draft !== "object") {
    return {
      valid: false,
      errors: [{ path: "draft", message: "draft is not an object" }],
    };
  }

  if (!Array.isArray(draft.shifts) || !draft.shifts.length) {
    addError(
      errors,
      "shifts",
      "Couldn't identify any staffing requirements in that request. Try naming a role and how many are needed.",
    );
  } else {
    draft.shifts.forEach((shift, index) => {
      const path = `shifts[${index}]`;
      if (!shift || typeof shift !== "object") {
        addError(errors, path, "must be an object");
        return;
      }

      const role = normalizeLower(shift.role);
      if (!role) {
        addError(
          errors,
          `${path}.role`,
          "No role was recognized in that request.",
          context.roleFamilies,
        );
      } else if (allowedRoles.size && !allowedRoles.has(role)) {
        addError(
          errors,
          `${path}.role`,
          `'${shift.role}' isn't a role configured for this facility.`,
          context.roleFamilies,
        );
      }

      if (shift.unitArea && allowedUnitAreas.size) {
        if (!allowedUnitAreas.has(normalizeLower(shift.unitArea))) {
          addError(
            errors,
            `${path}.unitArea`,
            `'${shift.unitArea}' isn't a unit area configured for this facility.`,
            context.unitAreas,
          );
        }
      }

      const shiftType = normalizeLower(shift.shiftType);
      const shiftTag = normalizeLower(shift.shiftTag);
      if (Boolean(shiftType) !== Boolean(shiftTag)) {
        addError(
          errors,
          `${path}.shiftType`,
          "shiftType and shiftTag must be set together, or both left empty.",
        );
      } else if (shiftType && shiftTag) {
        const slots = context.shiftSlotsByType[shiftType] || [];
        if (!slots.some((slot) => slot.tag === shiftTag)) {
          addError(
            errors,
            `${path}.shiftTag`,
            `'${shift.shiftTag}' isn't a configured time slot for shift type '${shift.shiftType}'.`,
            slots.map((slot) => slot.tag),
          );
        }
      } else {
        if (!HH_MM_PATTERN.test(String(shift.startTime || ""))) {
          addError(
            errors,
            `${path}.startTime`,
            "No valid start time (HH:MM) was found for this shift, and it didn't match a configured shift slot either.",
          );
        }
        if (!HH_MM_PATTERN.test(String(shift.endTime || ""))) {
          addError(
            errors,
            `${path}.endTime`,
            "No valid end time (HH:MM) was found for this shift, and it didn't match a configured shift slot either.",
          );
        }
      }

      if (!Number.isInteger(shift.requiredCount) || shift.requiredCount < 1) {
        addError(
          errors,
          `${path}.requiredCount`,
          "Couldn't determine how many staff are needed; requiredCount must be a whole number of 1 or more.",
        );
      }

      const certTags = Array.isArray(shift.requiredCertificationTags)
        ? shift.requiredCertificationTags
        : [];
      if (allowedCertTags.size) {
        certTags.forEach((tag) => {
          if (!allowedCertTags.has(normalizeLower(tag))) {
            addError(
              errors,
              `${path}.requiredCertificationTags`,
              `'${tag}' isn't a certification tag configured for this facility.`,
              context.certificationTags,
            );
          }
        });
      }
    });
  }

  const pattern = draft.datePattern;
  if (!pattern || typeof pattern !== "object") {
    addError(
      errors,
      "datePattern",
      "Couldn't determine which dates this applies to. Try including a start date or phrase like 'starting next Monday'.",
    );
  } else {
    if (!ISO_DATE_PATTERN.test(String(pattern.startDate || ""))) {
      addError(
        errors,
        "datePattern.startDate",
        "Couldn't resolve a valid start date (expected YYYY-MM-DD).",
      );
    }
    if (!Number.isInteger(pattern.horizonDays) || pattern.horizonDays < 1) {
      addError(
        errors,
        "datePattern.horizonDays",
        "horizonDays must be a positive whole number of days.",
      );
    }
    if (!REPEAT_MODES.includes(pattern.repeatMode)) {
      addError(
        errors,
        "datePattern.repeatMode",
        `repeatMode must be one of the supported patterns.`,
        REPEAT_MODES,
      );
    }
    if (pattern.repeatMode === "custom") {
      if (
        !Array.isArray(pattern.customWeekdays) ||
        !pattern.customWeekdays.length ||
        pattern.customWeekdays.some(
          (day) => !Number.isInteger(day) || day < 0 || day > 6,
        )
      ) {
        addError(
          errors,
          "datePattern.customWeekdays",
          "When repeatMode is 'custom', customWeekdays must be a non-empty list of integers 0 (Sunday) through 6 (Saturday).",
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── registry ───────────────────────────────────────────────────────────────
// Each entry: contextFields (facility prefs fields to expose), permission
// gate, and the three functions that turn context into a tool call + prompt
// and validate the model's output. Stubs (manualSchedule, staff) are wired
// into the registry shape but intentionally left without prompts/schemas
// until their own follow-up work.

const FORM_PARSERS = {
  coverage: {
    permission: "coverage.manage",
    contextFields: [
      "roleFamilies",
      "unitAreas",
      "shiftTypeDefinitions",
      "certificationTags",
    ],
    buildContext: buildCoverageContext,
    buildTool: buildCoverageTool,
    buildSystemPrompt: buildCoverageSystemPrompt,
    normalizeDraft: normalizeCoverageDraft,
    validateDraft: validateCoverageDraft,
    describeConfigGaps: describeCoverageConfigGaps,
  },

  manualSchedule: {
    permission: "schedule.manage",
    contextFields: ["roleFamilies", "unitAreas"],
    // Needs live open coverage + staff lookups in addition to facility
    // taxonomy; not implemented yet.
    buildContext: null,
    buildTool: null,
    buildSystemPrompt: null,
    validateDraft: null,
  },

  staff: {
    permission: "staff.manage",
    contextFields: [
      "roleFamilies",
      "unitAreas",
      "shiftTypeDefinitions",
      "certificationTags",
    ],
    buildContext: null,
    buildTool: null,
    buildSystemPrompt: null,
    validateDraft: null,
  },
};

function getFormParserConfig(formType) {
  return FORM_PARSERS[formType] || null;
}

function isFormParserImplemented(config) {
  return Boolean(
    config &&
    config.buildContext &&
    config.buildTool &&
    config.buildSystemPrompt &&
    config.validateDraft,
  );
}

function getTodayInfo(facilityTimezone) {
  const now = DateTime.local().setZone(facilityTimezone || "UTC");
  const zoned = now.isValid ? now : DateTime.utc();
  return {
    isoDate: zoned.toISODate(),
    weekday: zoned.toFormat("cccc"),
  };
}

module.exports = {
  FORM_PARSERS,
  getFormParserConfig,
  isFormParserImplemented,
  getTodayInfo,
  normalizeCoverageDraft,
  parseCoverageCopyRequest,
  buildCoverageCopyDraft,
};
