/**
 * Authenticates a staff member by their personal link token
 * (/api/v1/s/:token/...). Sets req.user / req.tenantId / req.tenant /
 * req.plan exactly like auth + tenant middleware do for accounts, so the
 * existing staff controllers work unchanged.
 */
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");
const StaffLink = require("../models/staffLinkModel");
const { findLiveLink } = require("../utils/staffLinks");
const {
  SYSTEM_ROLE_PERMISSIONS,
  getSystemRoles,
  getUserRoles,
} = require("../config/authorization");
const { getEffectivePlanKey, getPlan } = require("../config/plans");

const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

const linkNotFound = (res) =>
  res.status(404).json({
    message: "This link isn't active. Ask your scheduler to send you a new one.",
    errorCode: "LINK_INVALID",
  });

module.exports = async (req, res, next) => {
  try {
    const token = String(req.params.token || "");
    if (token.length < 40 || token.length > 64) return linkNotFound(res);

    const link = await findLiveLink(token);
    if (!link) return linkNotFound(res);

    const [user, tenant] = await Promise.all([
      User.findOne({
        _id: link.staffId,
        tenantId: link.tenantId,
        loginEnabled: false,
        status: "active",
      }),
      Tenant.findById(link.tenantId),
    ]);
    if (!user || !tenant) return linkNotFound(res);
    // Defensive: a staff link must never carry workspace powers.
    if (getSystemRoles(user).some((role) => role !== "staff")) {
      return linkNotFound(res);
    }

    req.user = user;
    req.user.roles = getUserRoles(user);
    req.user.permissions = [...SYSTEM_ROLE_PERMISSIONS.staff];
    req.tenantId = String(link.tenantId);
    req.tenant = tenant;
    req.plan = getPlan(getEffectivePlanKey(tenant));
    req.authKind = "staff_link";
    req.staffLinkId = link._id;

    if (
      !link.lastUsedAt ||
      Date.now() - new Date(link.lastUsedAt).getTime() >
        LAST_USED_WRITE_INTERVAL_MS
    ) {
      StaffLink.updateOne(
        { _id: link._id },
        { $set: { lastUsedAt: new Date() } },
      ).catch(() => {});
    }

    next();
  } catch (err) {
    next(err);
  }
};
