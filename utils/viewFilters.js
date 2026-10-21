/**
 * Saved view filters: which roles and unit areas a scheduler wants to see on
 * the week view ("schedule") and on Weekly Needs ("needs").
 * Input: { schedule?: { roles?: [], areas?: [] }, needs?: {...} }
 */
const { tagKey } = require("./tagKey");

const KINDS = ["schedule", "needs"];
const MAX_ITEMS = 50;
const MAX_LEN = 60;

const cleanList = (list, field, kind) => {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error(`viewFilters.${kind}.${field} must be a list`);
  if (list.length > MAX_ITEMS) throw new Error(`viewFilters.${kind}.${field} can have at most ${MAX_ITEMS} items`);
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") throw new Error(`viewFilters.${kind}.${field} must be a list of text`);
    const key = tagKey(item);
    if (!key) continue;
    if (key.length > MAX_LEN) throw new Error(`viewFilters.${kind}.${field} items must be ${MAX_LEN} characters or fewer`);
    if (!out.includes(key)) out.push(key);
  }
  return out;
};

/** Returns only the kinds that were sent, cleaned. Throws on bad input. */
function normalizeViewFilters(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("viewFilters must be an object");
  }
  const unknown = Object.keys(input).filter((k) => !KINDS.includes(k));
  if (unknown.length) throw new Error(`Unknown view filter: ${unknown.join(", ")}`);
  const out = {};
  for (const kind of KINDS) {
    if (input[kind] === undefined) continue;
    const value = input[kind] || {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error(`viewFilters.${kind} must be an object`);
    out[kind] = { roles: cleanList(value.roles, "roles", kind), areas: cleanList(value.areas, "areas", kind) };
  }
  return out;
}

module.exports = { normalizeViewFilters };
