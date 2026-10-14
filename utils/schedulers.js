const User = require("../models/userModel");

// Roles that run the schedule ("admin" is the legacy name for scheduler).
const SCHEDULER_ROLE_NAMES = ["owner", "administrator", "scheduler", "admin"];

/**
 * Active owner/scheduler accounts in a workspace — the people who should
 * hear about time-off requests, swaps, call-outs, etc.
 */
const findSchedulers = (tenantId, excludeUserIds = []) =>
  User.find({
    tenantId,
    status: { $ne: "archived" },
    $or: [
      { roles: { $in: SCHEDULER_ROLE_NAMES } },
      { role: { $in: SCHEDULER_ROLE_NAMES } },
    ],
    _id: { $nin: excludeUserIds.map((id) => id.toString()) },
  });

module.exports = { findSchedulers, SCHEDULER_ROLE_NAMES };
