const SYSTEM_ROLE_PERMISSIONS = Object.freeze({
  staff: [
    "schedule.view_own",
    "schedule.pick_up",
    "schedule.update_own_status",
    "timeoff.request",
    "shift_swap.use",
    "messages.use",
    "preferences.manage_own",
  ],
  // Schedulers run the schedule and the staff list, but not billing or
  // workspace settings. ("admin" is a legacy alias of scheduler.)
  scheduler: [
    "schedule.view",
    "schedule.manage",
    "coverage.view",
    "coverage.manage",
    "staff.view",
    "staff.manage",
    "staff.reset_password",
    "timeoff.review",
    "messages.manage",
    "facility_preferences.view",
    "facility_preferences.manage",
    "labor.view",
  ],
  // Read-only access to the schedule (e.g. a DON). Free on every plan.
  viewer: [
    "schedule.view",
    "coverage.view",
    "staff.view",
    "facility_preferences.view",
    "labor.view",
  ],
  // Admin: everything the owner can do (plan and billing, inviting people)
  // except deleting the facility and transferring ownership. Stored as
  // "administrator" because "admin" is the legacy name for scheduler.
  administrator: [
    "schedule.view",
    "schedule.manage",
    "coverage.view",
    "coverage.manage",
    "staff.view",
    "staff.manage",
    "staff.reset_password",
    "timeoff.review",
    "messages.manage",
    "facility_preferences.view",
    "facility_preferences.manage",
    "billing.view",
    "billing.manage",
    "tenant.settings",
    "roles.manage",
    "labor.view",
    "labor.costs",
    "labor.manage",
  ],
  owner: [
    "schedule.view",
    "schedule.manage",
    "coverage.view",
    "coverage.manage",
    "staff.view",
    "staff.manage",
    "staff.reset_password",
    "timeoff.review",
    "messages.manage",
    "facility_preferences.manage",
    "billing.view",
    "billing.manage",
    "tenant.settings",
    "tenant.delete",
    "roles.manage",
    "ownership.transfer",
    "labor.view",
    "labor.costs",
    "labor.manage",
  ],
});

const LEGACY_ROLE_ALIASES = Object.freeze({
  user: "staff",
  other: "staff",
  admin: "scheduler",
});

const SYSTEM_ROLES = new Set(Object.keys(SYSTEM_ROLE_PERMISSIONS));
const RESERVED_ROLES = new Set([
  ...SYSTEM_ROLES,
  ...Object.keys(LEGACY_ROLE_ALIASES),
]);

// Roles that make someone a workspace account (can sign in).
const ACCOUNT_ROLES = new Set(["owner", "administrator", "scheduler", "viewer"]);

const normalizeRole = (role) =>
  String(role || "")
    .trim()
    .toLowerCase();

const getUserRoles = (user) => {
  if (Array.isArray(user?.roles) && user.roles.length) {
    return Array.from(new Set(user.roles.map(normalizeRole).filter(Boolean)));
  }

  const legacyRole = normalizeRole(user?.role);
  return legacyRole ? [legacyRole] : [];
};

const getCanonicalSystemRole = (role) => {
  const normalized = normalizeRole(role);
  return LEGACY_ROLE_ALIASES[normalized] || normalized;
};

const getSystemRoles = (user) =>
  getUserRoles(user)
    .map(getCanonicalSystemRole)
    .filter((role) => SYSTEM_ROLES.has(role));

const getFacilityRoles = (user, facilityRoleFamilies = []) => {
  const facilityRoleSet = new Set(
    facilityRoleFamilies.map(normalizeRole).filter(Boolean),
  );

  return getUserRoles(user).filter((role) => facilityRoleSet.has(role));
};

// Staff permissions only apply to people without a workspace role, so a
// viewer can't request swaps or pick up shifts.
const getEffectivePermissions = (user) => {
  const workspaceRoles = getSystemRoles(user).filter(
    (role) => role !== "staff",
  );
  if (!workspaceRoles.length) return [...SYSTEM_ROLE_PERMISSIONS.staff];

  return Array.from(
    new Set(
      workspaceRoles.flatMap((role) => SYSTEM_ROLE_PERMISSIONS[role] || []),
    ),
  );
};

const hasPermission = (user, permission) =>
  getEffectivePermissions(user).includes(permission);

const hasAnyPermission = (user, permissions) =>
  permissions.some((permission) => hasPermission(user, permission));

const hasSystemRole = (user, role) =>
  getSystemRoles(user).includes(getCanonicalSystemRole(role));

module.exports = {
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLES,
  RESERVED_ROLES,
  ACCOUNT_ROLES,
  LEGACY_ROLE_ALIASES,
  normalizeRole,
  getUserRoles,
  getSystemRoles,
  getFacilityRoles,
  getEffectivePermissions,
  hasPermission,
  hasAnyPermission,
  hasSystemRole,
};
