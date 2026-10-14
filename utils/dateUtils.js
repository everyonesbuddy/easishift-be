/**
 * Date and shift-slot helpers shared by coverage, the staffing template and
 * weeks.
 *
 * Conventions:
 *  - A "date key" is a facility-local calendar day as "YYYY-MM-DD".
 *  - Coverage.date / ScheduleWeek.weekStart store that day at 00:00Z.
 *  - startTime / endTime are real UTC instants.
 */
const { DateTime } = require("luxon");

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

// Coverage.date is the facility-local calendar day stored at 00:00Z.
// For strings ("2026-10-11" or "2026-10-11T00:00:00+01:00") the calendar day
// written in the string wins, so a local midnight never shifts to the
// previous/next UTC day. Date objects fall back to their UTC day.
function normalizeToUTC(date) {
  if (typeof date === "string") {
    const match = date.trim().match(DATE_KEY_PATTERN);
    if (match) {
      return new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      );
    }
  }
  const d = new Date(date);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function normalizeShiftType(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeShiftTag(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeFacilityTimezone(value) {
  const timezone = String(value || "UTC").trim();
  return DateTime.local().setZone(timezone).isValid ? timezone : "UTC";
}

function parseClockTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function dedupeStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function getConfiguredShiftTypes(facilityPrefs) {
  const fromLegacyList = dedupeStrings(facilityPrefs?.shiftTypes || []).map(
    normalizeShiftType,
  );
  const fromDefinitions = dedupeStrings(
    (facilityPrefs?.shiftTypeDefinitions || []).map((item) => item?.key),
  ).map(normalizeShiftType);

  const merged = dedupeStrings([...fromLegacyList, ...fromDefinitions]);
  if (merged.length) return merged;
  return ["day", "evening", "night"];
}

function buildShiftSlotLookup(facilityPrefs) {
  const lookup = new Map();

  for (const definition of facilityPrefs?.shiftTypeDefinitions || []) {
    const shiftType = normalizeShiftType(definition?.key);
    if (!shiftType) continue;

    for (const slot of definition?.timeSlots || []) {
      const shiftTag = normalizeShiftTag(slot?.tag);
      if (!shiftTag) continue;

      const startLocal = String(slot?.startLocalTime || "").trim();
      const endLocal = String(slot?.endLocalTime || "").trim();
      if (!startLocal || !endLocal) continue;

      lookup.set(`${shiftType}:${shiftTag}`, {
        shiftType,
        shiftTag,
        startLocalTime: startLocal,
        endLocalTime: endLocal,
        spansOvernight: Boolean(slot?.spansOvernight),
      });
    }
  }

  return lookup;
}

function buildWindowFromShiftSlot({
  date,
  shiftType,
  shiftTag,
  slotLookup,
  facilityTimezone,
}) {
  const slot = slotLookup.get(`${shiftType}:${shiftTag}`);
  if (!slot) {
    return {
      error: `No shift slot configuration found for shiftType '${shiftType}' and shiftTag '${shiftTag}'`,
    };
  }

  const startClock = parseClockTime(slot.startLocalTime);
  const endClock = parseClockTime(slot.endLocalTime);
  if (!startClock || !endClock) {
    return {
      error: `Invalid local slot time configuration for shiftType '${shiftType}' and shiftTag '${shiftTag}'`,
    };
  }

  const anchorDate = new Date(date);
  const year = anchorDate.getUTCFullYear();
  const month = anchorDate.getUTCMonth() + 1;
  const day = anchorDate.getUTCDate();

  const localStart = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour: startClock.hour,
      minute: startClock.minute,
      second: 0,
      millisecond: 0,
    },
    { zone: facilityTimezone },
  );

  let localEnd = DateTime.fromObject(
    {
      year,
      month,
      day,
      hour: endClock.hour,
      minute: endClock.minute,
      second: 0,
      millisecond: 0,
    },
    { zone: facilityTimezone },
  );

  if (!localStart.isValid || !localEnd.isValid) {
    return {
      error: `Failed to parse local slot window for shiftType '${shiftType}' and shiftTag '${shiftTag}' in timezone '${facilityTimezone}'`,
    };
  }

  if (slot.spansOvernight || localEnd <= localStart) {
    localEnd = localEnd.plus({ days: 1 });
  }

  return {
    startTime: localStart.toUTC().toJSDate(),
    endTime: localEnd.toUTC().toJSDate(),
  };
}

const isDateKey = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  DateTime.fromISO(value, { zone: "UTC" }).isValid;

const dateKeyToCoverageDate = (key) => new Date(`${key}T00:00:00.000Z`);

const coverageDateToKey = (date) => new Date(date).toISOString().slice(0, 10);

// Luxon weekday is Mon=1..Sun=7; we use Sun=0..Sat=6.
const weekdayOfKey = (key) =>
  DateTime.fromISO(key, { zone: "UTC" }).weekday % 7;

/** The week-start date key (YYYY-MM-DD) of the week containing `instant`. */
function weekStartFor(instant, timezone, weekStartsOn = 0) {
  const local = DateTime.fromJSDate(new Date(instant), {
    zone: normalizeFacilityTimezone(timezone),
  }).startOf("day");
  const diff = ((local.weekday % 7) - weekStartsOn + 7) % 7;
  return local.minus({ days: diff }).toISODate();
}

/** The 7 date keys starting at `startKey`. */
const weekDays = (startKey) =>
  Array.from({ length: 7 }, (_, i) =>
    DateTime.fromISO(startKey, { zone: "UTC" }).plus({ days: i }).toISODate(),
  );

const addDaysToKey = (key, days) =>
  DateTime.fromISO(key, { zone: "UTC" }).plus({ days }).toISODate();

/** UTC instants for local midnight at the start and end of a week. */
function weekBounds(startKey, timezone) {
  const zone = normalizeFacilityTimezone(timezone);
  const start = DateTime.fromISO(startKey, { zone }).startOf("day");
  return {
    start: start.toUTC().toJSDate(),
    end: start.plus({ days: 7 }).toUTC().toJSDate(),
  };
}

/**
 * The facility shift time (shiftType + shiftTag) whose hours on `date` are
 * exactly startTime–endTime, or null. Lets custom-time needs (old Coverage
 * Planning) line up with the named rows Weekly Needs makes.
 */
function findShiftSlotForWindow({ date, startTime, endTime, slotLookup, facilityTimezone }) {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  for (const slot of slotLookup.values()) {
    const window = buildWindowFromShiftSlot({
      date,
      shiftType: slot.shiftType,
      shiftTag: slot.shiftTag,
      slotLookup,
      facilityTimezone,
    });
    if (window.error) continue;
    if (window.startTime.getTime() === start && window.endTime.getTime() === end) {
      return { shiftType: slot.shiftType, shiftTag: slot.shiftTag };
    }
  }
  return null;
}

module.exports = {
  normalizeToUTC,
  normalizeShiftType,
  normalizeShiftTag,
  normalizeFacilityTimezone,
  parseClockTime,
  dedupeStrings,
  getConfiguredShiftTypes,
  buildShiftSlotLookup,
  buildWindowFromShiftSlot,
  findShiftSlotForWindow,
  isDateKey,
  dateKeyToCoverageDate,
  coverageDateToKey,
  weekdayOfKey,
  weekStartFor,
  weekDays,
  addDaysToKey,
  weekBounds,
};
