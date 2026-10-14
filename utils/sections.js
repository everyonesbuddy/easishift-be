/**
 * A "section" of the schedule: some roles and/or unit areas (e.g. only
 * Concierge, or only Assisted Living). Used to publish or auto-fill part of
 * a week when several schedulers work on it.
 */
const { tagKey } = require("./tagKey");

const list = (value) =>
  (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => tagKey(item))
    .filter(Boolean);

/** { roles, areas } from a request body, or null for "everything". */
const parseSection = (body) => {
  const roles = new Set(list(body?.roles));
  const areas = new Set(list(body?.areas));
  if (!roles.size && !areas.size) return null;
  return { roles, areas };
};

/** Does a shift or open spot (role, unitArea) belong to the section? */
const inSection = (item, section) => {
  if (!section) return true;
  if (section.roles.size && !section.roles.has(tagKey(item?.role))) return false;
  if (section.areas.size && !section.areas.has(tagKey(item?.unitArea))) return false;
  return true;
};

const sectionResponse = (section) =>
  section ? { roles: [...section.roles], areas: [...section.areas] } : null;

module.exports = { parseSection, inSection, sectionResponse };
