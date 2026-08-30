const { DateTime } = require("luxon");

/**
 * Convert staff preferred local time to UTC for a specific day.
 * @param {String} dayISO - "2025-04-10"
 * @param {String} timeStr - "09:00"
 * @param {String} timezone - "America/New_York"
 */
exports.localPrefToUTC = (dayISO, timeStr, timezone = "UTC") => {
  if (!timeStr) return null;

  const dt = DateTime.fromISO(`${dayISO}T${timeStr}`, { zone: timezone });
  return dt.toUTC().toJSDate();
};

const normalizeZone = (timezone) => {
  const zone = String(timezone || "UTC").trim();
  return DateTime.local().setZone(zone).isValid ? zone : "UTC";
};

exports.normalizeZone = normalizeZone;

/**
 * Format an instant in facility-local time with its zone abbreviation,
 * e.g. "Mon, Sep 1, 2026, 7:00 AM EDT".
 */
exports.formatInFacilityZone = (value, timezone) => {
  const dt = DateTime.fromJSDate(new Date(value)).setZone(
    normalizeZone(timezone),
  );
  if (!dt.isValid) return "";
  return dt.toFormat("EEE, LLL d, yyyy, h:mm a ZZZZ");
};

/**
 * Format a start/end pair, collapsing the date when both fall on the same
 * local day: "Mon, Sep 1, 2026, 7:00 AM - 3:00 PM EDT".
 */
exports.formatRangeInFacilityZone = (start, end, timezone) => {
  const zone = normalizeZone(timezone);
  const startDt = DateTime.fromJSDate(new Date(start)).setZone(zone);
  const endDt = DateTime.fromJSDate(new Date(end)).setZone(zone);

  if (!startDt.isValid || !endDt.isValid) return "";

  if (startDt.hasSame(endDt, "day")) {
    return `${startDt.toFormat("EEE, LLL d, yyyy, h:mm a")} - ${endDt.toFormat(
      "h:mm a ZZZZ",
    )}`;
  }

  return `${startDt.toFormat(
    "EEE, LLL d, yyyy, h:mm a",
  )} - ${endDt.toFormat("EEE, LLL d, yyyy, h:mm a ZZZZ")}`;
};
