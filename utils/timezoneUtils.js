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
