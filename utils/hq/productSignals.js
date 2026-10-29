/**
 * HQ: how each signed-up workspace is doing, in a shape the plays and the
 * Signups screen can use. summarizeWorkspace is pure; loadWorkspaces queries.
 */
const { LEADERSHIP } = require("./roles");
const { isPaid, isTrialActive } = require("../../config/plans");

const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT_ROLES = ["owner", "administrator", "scheduler", "viewer"];
const rolesOf = (u) => [...new Set([...(u.roles || []), u.role].filter(Boolean))];

function summarizeWorkspace({ tenant, members = [], staffCount = 0, shifts14 = 0, laborSettings = null, now = new Date() }) {
  const owner = members.find((m) => rolesOf(m).includes("owner")) || members[0] || null;
  const lastActiveAt = members.reduce((max, m) => (m.lastSeenAt && (!max || m.lastSeenAt > max) ? m.lastSeenAt : max), null);
  const recentLogin = lastActiveAt && now - new Date(lastActiveAt) <= 7 * DAY;
  const signupRole = tenant.signupRole || "";
  const admins = members.filter((m) => m !== owner && rolesOf(m).includes("administrator"));
  const extra = laborSettings?.mondayReport?.extraRecipients || [];
  const leadershipReached =
    (LEADERSHIP.includes(signupRole)) || admins.length > 0 || extra.length > 0;
  const trialDaysLeft =
    tenant.trialEndsAt && isTrialActive(tenant, now) ? Math.ceil((new Date(tenant.trialEndsAt) - now) / DAY) : null;
  return {
    tenantId: String(tenant._id),
    name: tenant.name,
    email: tenant.email,
    facilityType: tenant.facilityType || "",
    createdAt: tenant.createdAt,
    setupDone: Boolean(tenant.setupCompletedAt),
    plan: tenant.plan,
    subscriptionStatus: tenant.subscriptionStatus,
    paid: isPaid(tenant) && tenant.subscriptionStatus === "active",
    trialDaysLeft,
    trialEndsAt: tenant.trialEndsAt || null,
    signupRole,
    heardAbout: tenant.heardAboutOther ? `${tenant.heardAbout || "other"}: ${tenant.heardAboutOther}` : tenant.heardAbout || "",
    signupSource: tenant.signupSource || null,
    ownerName: owner?.name || "",
    ownerEmail: owner?.email || tenant.email || "",
    members: members.map((m) => ({ name: m.name, email: m.email, roles: rolesOf(m).filter((r) => ACCOUNT_ROLES.includes(r)), lastSeenAt: m.lastSeenAt || null })),
    staffCount,
    shifts14,
    lastActiveAt,
    active: Boolean(recentLogin || shifts14 >= 5),
    leadershipReached,
    mondayEmail: {
      enabled: laborSettings ? laborSettings.mondayReport?.enabled !== false : null,
      extraRecipients: extra,
      lastSentWeek: laborSettings?.mondayReport?.lastSentWeek || null,
    },
  };
}

async function loadWorkspaces({ now = new Date(), tenantIds = null } = {}) {
  const Tenant = require("../../models/tenantModel");
  const User = require("../../models/userModel");
  const Schedule = require("../../models/scheduleModel");
  const LaborSettings = require("../../models/laborSettingsModel");

  const tq = tenantIds ? { _id: { $in: tenantIds } } : {};
  const tenants = await Tenant.find(tq)
    .select("name email facilityType createdAt setupCompletedAt plan subscriptionStatus trialEndsAt signupRole heardAbout heardAboutOther signupSource")
    .sort({ createdAt: -1 })
    .lean();
  const ids = tenants.map((t) => t._id);
  const since = new Date(now - 14 * DAY);
  const [members, staffCounts, shiftCounts, settings] = await Promise.all([
    User.find({ tenantId: { $in: ids }, loginEnabled: true, status: { $ne: "archived" } })
      .select("tenantId name email role roles lastSeenAt")
      .lean(),
    User.aggregate([
      { $match: { tenantId: { $in: ids }, status: { $ne: "archived" } } },
      { $group: { _id: "$tenantId", n: { $sum: 1 } } },
    ]),
    Schedule.aggregate([
      { $match: { tenantId: { $in: ids }, createdAt: { $gte: since } } },
      { $group: { _id: "$tenantId", n: { $sum: 1 } } },
    ]),
    LaborSettings.find({ tenantId: { $in: ids } }).select("tenantId mondayReport").lean(),
  ]);
  const by = (list, key = "tenantId") => {
    const m = new Map();
    for (const x of list) {
      const k = String(x[key]);
      m.set(k, [...(m.get(k) || []), x]);
    }
    return m;
  };
  const membersBy = by(members);
  const staffBy = new Map(staffCounts.map((s) => [String(s._id), s.n]));
  const shiftsBy = new Map(shiftCounts.map((s) => [String(s._id), s.n]));
  const settingsBy = new Map(settings.map((s) => [String(s.tenantId), s]));
  return tenants.map((tenant) => {
    const k = String(tenant._id);
    return summarizeWorkspace({
      tenant,
      members: membersBy.get(k) || [],
      staffCount: staffBy.get(k) || 0,
      shifts14: shiftsBy.get(k) || 0,
      laborSettings: settingsBy.get(k) || null,
      now,
    });
  });
}

module.exports = { summarizeWorkspace, loadWorkspaces };
