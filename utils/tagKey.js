/**
 * Canonical form for unit areas and certification tags, so "Memory Care",
 * "memory care" and "memory_care" are the same tag when matching staff to
 * coverage.
 */
const tagKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "_");

module.exports = { tagKey };
