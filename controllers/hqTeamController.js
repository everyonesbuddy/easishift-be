/**
 * HQ team activity: per workspace, every person and how they use
 * WiserShifts (last seen in the app or on their link, device, texts,
 * shifts, clock-ins, call-outs picked up). Signups shows the workspace;
 * this shows the people in it.
 */
const mongoose = require("mongoose");
const Tenant = require("../models/tenantModel");
const { loadWorkspaces } = require("../utils/hq/productSignals");
const { loadTeam, loadTeamCounts } = require("../utils/hq/teamActivity");

/** GET /hq/team[?all=1]: each workspace with its people, seen this week and never seen. Test and demo workspaces only with all=1. */
exports.list = async (req, res, next) => {
  try {
    const now = new Date();
    const workspaces = await loadWorkspaces({ now, includeTagged: req.query.all === "1" });
    const counts = await loadTeamCounts(workspaces.map((w) => new mongoose.Types.ObjectId(String(w.tenantId))), now);
    const rows = workspaces
      .map((w) => ({
        tenantId: String(w.tenantId),
        name: w.name,
        paid: w.paid,
        trialDaysLeft: w.trialDaysLeft,
        tag: w.tag || null,
        ...(counts.get(String(w.tenantId)) || { people: 0, seen7: 0, neverSeen: 0, lastSeenAt: null }),
      }))
      .sort((a, b) => Number(b.paid) - Number(a.paid) || (b.lastSeenAt ? new Date(b.lastSeenAt) : 0) - (a.lastSeenAt ? new Date(a.lastSeenAt) : 0));
    res.json({ workspaces: rows });
  } catch (err) {
    next(err);
  }
};

/** GET /hq/team/:tenantId: everyone in one workspace and how they use it. */
exports.get = async (req, res, next) => {
  try {
    const { tenantId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(tenantId)) return res.status(400).json({ message: "Which workspace?" });
    const tenant = await Tenant.findById(tenantId).select("name plan subscriptionStatus createdAt").lean();
    if (!tenant) return res.status(404).json({ message: "That workspace isn't here." });
    const team = await loadTeam(tenant._id, new Date());
    res.json({ workspace: { tenantId: String(tenant._id), name: tenant.name, plan: tenant.plan, subscriptionStatus: tenant.subscriptionStatus, createdAt: tenant.createdAt }, ...team });
  } catch (err) {
    next(err);
  }
};
