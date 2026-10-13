/**
 * Back to the plan's limits
 * -------------------------
 * POST /api/v1/billing/fit-to-plan   (owner)
 * Body: { keepStaffIds?: string[], keepSchedulerIds?: string[] }
 *
 * After a trial ends (or a downgrade) with more people than the plan allows,
 * the owner picks who stays active in one go:
 *   - active staff not in keepStaffIds are archived (history kept, future
 *     shifts become open slots, links turned off; restorable later);
 *   - schedulers not in keepSchedulerIds become viewers (free, read-only).
 * The owner always stays and counts as one scheduler. Send only the list(s)
 * you want to change.
 */
const mongoose = require("mongoose");
const User = require("../models/userModel");
const { getUserRoles } = require("../config/authorization");
const { serializeLimit } = require("../config/plans");
const { getUsage, SCHEDULER_ROLES } = require("../utils/planLimits");
const { archiveStaffMember } = require("./staffController");

const toIdSet = (value) =>
  new Set((Array.isArray(value) ? value : []).map(String));

const badIds = (ids) => [...ids].filter((id) => !mongoose.isValidObjectId(id));

exports.fitToPlan = async (req, res, next) => {
  try {
    const plan = req.plan;
    const body = req.body || {};
    const hasStaffList = Array.isArray(body.keepStaffIds);
    const hasSchedulerList = Array.isArray(body.keepSchedulerIds);
    if (!hasStaffList && !hasSchedulerList) {
      return res
        .status(400)
        .json({ message: "Send keepStaffIds and/or keepSchedulerIds" });
    }
    const keepStaff = toIdSet(body.keepStaffIds);
    const keepSchedulers = toIdSet(body.keepSchedulerIds);
    if (badIds(keepStaff).length || badIds(keepSchedulers).length) {
      return res.status(400).json({ message: "Invalid id in the lists" });
    }

    const [activeStaff, accounts] = await Promise.all([
      hasStaffList
        ? User.find({ tenantId: req.tenantId, loginEnabled: false, status: "active" })
        : [],
      hasSchedulerList
        ? User.find({ tenantId: req.tenantId, loginEnabled: true, status: { $ne: "archived" } })
        : [],
    ]);

    // Validate everything before changing anything.
    if (hasStaffList) {
      const activeIds = new Set(activeStaff.map((s) => String(s._id)));
      const unknown = [...keepStaff].filter((id) => !activeIds.has(id));
      if (unknown.length) {
        return res.status(400).json({
          message: "Some kept staff aren't active staff in this workspace",
          unknownIds: unknown,
        });
      }
      if (keepStaff.size > plan.staff) {
        return res.status(400).json({
          message: `The ${plan.label} plan allows ${plan.staff} active staff; you chose ${keepStaff.size}.`,
          errorCode: "TOO_MANY_KEPT",
          kind: "staff",
          limit: serializeLimit(plan.staff),
        });
      }
    }

    const isOwner = (u) => getUserRoles(u).includes("owner");
    const isScheduler = (u) =>
      !isOwner(u) && getUserRoles(u).some((r) => SCHEDULER_ROLES.includes(r));
    let demote = [];
    if (hasSchedulerList) {
      const schedulers = accounts.filter(isScheduler);
      const schedulerIds = new Set(schedulers.map((u) => String(u._id)));
      const unknown = [...keepSchedulers].filter((id) => !schedulerIds.has(id));
      if (unknown.length) {
        return res.status(400).json({
          message: "Some kept schedulers aren't schedulers in this workspace",
          unknownIds: unknown,
        });
      }
      const owners = accounts.filter(isOwner).length;
      if (owners + keepSchedulers.size > plan.schedulers) {
        return res.status(400).json({
          message: `The ${plan.label} plan allows ${plan.schedulers} scheduler${plan.schedulers === 1 ? "" : "s"}, including the owner.`,
          errorCode: "TOO_MANY_KEPT",
          kind: "schedulers",
          limit: serializeLimit(plan.schedulers),
        });
      }
      demote = schedulers.filter((u) => !keepSchedulers.has(String(u._id)));
    }

    let archivedStaff = 0;
    let removedFutureShifts = 0;
    for (const staff of activeStaff) {
      if (keepStaff.has(String(staff._id))) continue;
      const result = await archiveStaffMember(req.tenantId, staff);
      archivedStaff += 1;
      removedFutureShifts += result.removedFutureShifts;
    }

    for (const member of demote) {
      member.role = "viewer";
      member.roles = ["viewer"];
      await member.save({ validateBeforeSave: false });
    }

    res.json({
      archivedStaff,
      removedFutureShifts,
      schedulersMadeViewers: demote.length,
      usage: await getUsage(req),
    });
  } catch (err) {
    next(err);
  }
};
