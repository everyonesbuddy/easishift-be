/**
 * HQ: sort a job title into the buyer roles we market to. Order matters:
 * "Regional Director of Operations" is regional, not executive director.
 */
const RULES = [
  ["regional", /\b(regional|vp|vice president|svp|evp|chief|coo|ceo|cfo|cno|president|director of operations|area director|divisional)\b/i],
  ["owner", /\b(owner|founder|co-founder|principal|proprietor|managing member|partner)\b/i],
  ["don", /\b(d\.?o\.?n\.?|director of nursing|director of clinical|nurse manager|health services director|director of health|wellness director|director of wellness|resident care director|dhs|rcd|adon|assistant director of nursing)\b/i],
  ["executive_director", /\b(executive director|e\.?d\.?|community director|general manager|residence director)\b/i],
  ["administrator", /\b(administrator|nha|facility director|campus director|operations manager)\b/i],
  ["scheduler", /\b(schedul\w*|staffing coordinator|staffing manager|staffing)\b/i],
];

const LABELS = {
  executive_director: "Executive Director",
  administrator: "Administrator",
  don: "Director of Nursing",
  regional: "Regional / C-suite",
  owner: "Owner",
  scheduler: "Scheduler",
  other: "Other",
};

const roleFromTitle = (title = "") => {
  const t = String(title || "").trim();
  if (!t) return "other";
  for (const [role, re] of RULES) if (re.test(t)) return role;
  return "other";
};

/** Roles that read the Monday labor email and sign the check. */
const LEADERSHIP = ["executive_director", "administrator", "don", "regional", "owner"];

module.exports = { roleFromTitle, LABELS, LEADERSHIP };
