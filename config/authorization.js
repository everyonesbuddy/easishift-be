const SYSTEM_ROLE_PERMISSIONS = Object.freeze({
  staff: [
    "schedule.view_own",
    "schedule.pick_up",
    "timeoff.request",
    "shift_swap.use",
    "messages.use",
    "preferences.manage_own",
  ],
  scheduler: [
    "schedule.view",
    "schedule.manage",
    "coverage.view",
    "coverage.manage",
    "staff.view",
    "facility_preferences.view",
  ],
  admin: [
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
  ],
});

const LEGACY_ROLE_ALIASES = Object.freeze({
  user: "staff",
  other: "staff",
});

const SYSTEM_ROLES = new Set(Object.keys(SYSTEM_ROLE_PERMISSIONS));
const RESERVED_ROLES = new Set([
  ...SYSTEM_ROLES,
  ...Object.keys(LEGACY_ROLE_ALIASES),
]);

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

const getEffectivePermissions = (user) => {
  const systemRoles = getSystemRoles(user);

  return Array.from(
    new Set([
      ...SYSTEM_ROLE_PERMISSIONS.staff,
      ...systemRoles.flatMap((role) => SYSTEM_ROLE_PERMISSIONS[role] || []),
    ]),
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
