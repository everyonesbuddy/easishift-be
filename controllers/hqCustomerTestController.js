/**
 * HQ: try the customer messages on a real workspace. Look one up by any of
 * its people's email, see its managers and whether they can get texts, and
 * send the morning summary, the next-step nudge or a sample call-out alert
 * for real, now. Sends go to that workspace's managers only.
 */
const mongoose = require("mongoose");
const Tenant = require("../models/tenantModel");
const User = require("../models/userModel");
const Preferences = require("../models/preferencesModel");
const { findSchedulers } = require("../utils/schedulers");
const { runFor, factsFor } = require("../utils/morningSummaryJobs");
const { alertManagers, appUrl } = require("../utils/managerAlerts");
const { getEffectivePlanKey, hasFeature } = require("../config/plans");
const { requestOptIn } = require("../utils/notify");

const fail = (res, status, message) => res.status(status).json({ message });
const TENANT_FIELDS = "name createdAt setupCompletedAt plan subscriptionStatus trialEndsAt";
const REASONS = {
  awaiting_opt_in: "Sent the opt-in text; texts start once they reply YES",
  sms_needs_upgrade: "This plan doesn't include texting, so email only",
  opted_out: "They replied STOP, so no texts",
  no_contact: "No phone or email on file",
  notifications_off: "Their notifications are off",
  send_failed: "The send failed",
};

async function describe(tenant) {
  const managers = await findSchedulers(tenant._id).select("name email phoneE164 smsConsent loginEnabled role roles").lean();
  const prefs = await Preferences.find({ tenantId: tenant._id, staffId: { $in: managers.map((m) => m._id) } }).select("staffId morningSummaryEnabled smsNotificationsEnabled emailNotificationsEnabled").lean();
  const prefOf = new Map(prefs.map((p) => [String(p.staffId), p]));
  const facts = await factsFor(tenant);
  return {
    tenant: { _id: String(tenant._id), name: tenant.name, createdAt: tenant.createdAt, setupDone: Boolean(tenant.setupCompletedAt), plan: getEffectivePlanKey(tenant), texting: hasFeature(getEffectivePlanKey(tenant), "sms") },
    managers: managers.map((m) => {
      const p = prefOf.get(String(m._id)) || {};
      return {
        _id: String(m._id),
        name: m.name,
        role: (m.roles && m.roles[0]) || m.role,
        email: m.email || "",
        phone: m.phoneE164 || "",
        texts: m.smsConsent?.status || "none",
        loginEnabled: m.loginEnabled !== false,
        morningSummary: p.morningSummaryEnabled !== false,
      };
    }),
    today: {
      shifts: facts.shiftsToday,
      open: facts.open.length,
      callouts: facts.callouts.length,
      pendingTimeOff: facts.pendingTimeOff,
      overtime: facts.overtime.length,
    },
    setup: facts.setup,
    nextStep: facts.step,
  };
}

/** GET /hq/customers/lookup?email= (anyone in the workspace) or ?q= (workspace name) */
exports.lookup = async (req, res, next) => {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    const q = String(req.query.q || "").trim();
    let tenant = null;
    if (email) {
      const u = await User.findOne({ email: new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }).select("tenantId").lean();
      if (u) tenant = await Tenant.findById(u.tenantId).select(TENANT_FIELDS).lean();
    } else if (q) {
      tenant = await Tenant.findOne({ name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).select(TENANT_FIELDS).lean();
    }
    if (!tenant) return fail(res, 404, "No workspace found for that.");
    res.json(await describe(tenant));
  } catch (err) {
    next(err);
  }
};

/** POST /hq/customers/:tenantId/test-message { which: "summary" | "nudge" | "callout" } */
exports.sendTest = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.tenantId)) return fail(res, 404, "Workspace not found.");
    const tenant = await Tenant.findById(req.params.tenantId).select(TENANT_FIELDS).lean();
    if (!tenant) return fail(res, 404, "Workspace not found.");
    const which = String(req.body?.which || "");
    let r;
    if (which === "summary" || which === "nudge") {
      r = await runFor(tenant, which, { force: true });
      if (r.skipped === "nothing_to_nudge") return fail(res, 409, "This workspace has nothing left to set up, so there's no nudge to send. Try the morning summary.");
    } else if (which === "callout") {
      const link = appUrl("/schedule");
      const results = await alertManagers({
        tenantId: tenant._id,
        kind: "callout_alert",
        sms: "WiserShifts (test): Test Staff called out of CNA tomorrow 7a–3p. 3 can cover it without overtime. Fill it: " + link,
        emailSubject: "(Test) Test Staff called out: tomorrow 7a–3p",
        emailHtml: `<p>This is a test of the call-out alert.</p><p><strong>Test Staff</strong> can't make their CNA shift tomorrow 7a–3p.</p><p>3 can cover it without overtime.</p><p><a href="${link}">Fill it</a></p>`,
      });
      r = { sent: results.filter((x) => x.delivered).length, results };
    } else return fail(res, 400, "Pick summary, nudge or callout.");
    const names = new Map((await describe(tenant)).managers.map((m) => [m._id, m]));
    res.json({
      which,
      sent: r.sent,
      results: (r.results || []).map((x) => ({
        name: names.get(x.managerId)?.name || x.managerId,
        delivered: Boolean(x.delivered),
        channel: x.channel || null,
        note: x.delivered ? (x.channel === "sms" ? "Texted" : "Emailed") : REASONS[x.reason] || x.reason || "",
      })),
      skipped: (r.results || []).length ? null : "No managers with a login to send to.",
    });
  } catch (err) {
    next(err);
  }
};

/** POST /hq/customers/:tenantId/opt-in { userId? }: send the managers' opt-in text now. */
exports.sendOptIn = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.tenantId)) return fail(res, 404, "Workspace not found.");
    const tenant = await Tenant.findById(req.params.tenantId).select(TENANT_FIELDS).lean();
    if (!tenant) return fail(res, 404, "Workspace not found.");
    const planKey = getEffectivePlanKey(tenant);
    let managers = await findSchedulers(tenant._id).select("name phoneE164 smsConsent loginEnabled").lean();
    if (req.body?.userId) managers = managers.filter((m) => String(m._id) === String(req.body.userId));
    const NOTE = { no_phone: "No phone: add it on Members", sms_needs_upgrade: "This plan doesn't include texting", already_opted_in: "Already gets texts", opted_out: "Said STOP, so we can't text them", send_failed: "The text failed to send" };
    const results = [];
    for (const m of managers) {
      if (m.loginEnabled === false) continue;
      const r = await requestOptIn({ tenant, planKey, person: m, manager: true });
      results.push({ name: m.name, delivered: r.sent, note: r.sent ? "Sent the opt-in text. Texts start once they reply START or YES." : NOTE[r.reason] || r.reason });
    }
    res.json({ sent: results.filter((r) => r.delivered).length, results });
  } catch (err) {
    next(err);
  }
};
