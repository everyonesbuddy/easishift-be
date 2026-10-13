/**
 * Phone helpers.
 *
 * buildE164Number("+1", "(555) 123-4567") -> "+15551234567"
 * buildE164Number(null, "+44 7700 900123") -> "+447700900123"
 * If no country code is given, DEFAULT_COUNTRY_CODE (or +1) is used.
 */
const defaultCountryCode = () =>
  String(process.env.DEFAULT_COUNTRY_CODE || "+1").trim();

const digitsOnly = (value) => String(value || "").replace(/\D+/g, "");

const buildE164Number = (countryCode, phone) => {
  if (!phone) return null;
  const raw = String(phone).trim();
  if (!raw) return null;

  if (raw.startsWith("+")) {
    const digits = digitsOnly(raw);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  const codeDigits = digitsOnly(countryCode || defaultCountryCode());
  let local = digitsOnly(raw);
  if (!codeDigits || !local) return null;
  // Drop a trunk "0" (e.g. 0803... in Nigeria, 07700... in the UK).
  if (local.startsWith("0")) local = local.replace(/^0+/, "");
  // Already includes the country code (e.g. "15551234567" with +1).
  if (local.startsWith(codeDigits) && local.length > 10) {
    local = local.slice(codeDigits.length);
  }

  // North American numbers are always 10 digits after the +1.
  if (codeDigits === "1" && local.length !== 10) return null;

  const full = `${codeDigits}${local}`;
  return full.length >= 8 && full.length <= 15 ? `+${full}` : null;
};

module.exports = { buildE164Number, digitsOnly };
