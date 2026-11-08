/**
 * Managers hear about things the moment they need them: owners,
 * administrators and schedulers get a text (on texting plans, once they've
 * opted in; the first alert asks them to) and otherwise an email. Same rules
 * as staff messages: their notification settings and consent are respected.
 */
const Tenant = require("../models/tenantModel");
const Preferences = require("../models/preferencesModel");
const { findSchedulers } = require("./schedulers");
const { sendToStaff } = require("./notify");
const { getEffectivePlanKey } = require("../config/plans");

const appUrl = (path = "") => `${String(process.env.FRONTEND_URL || "").replace(/\/+$/, "")}${path}`;

/**
 * kind: "callout_alert", "timeoff_alert", "morning_summary"…
 * sms / emailSubject / emailHtml: strings, or functions of the manager.
 */
async function alertManagers({ tenantId, kind, sms, emailSubject, emailHtml, refId = null, excludeUserIds = [], only = null }) {
  const out = [];
  try {
    const tenant = await Tenant.findById(tenantId).lean();
    if (!tenant) return out;
    const planKey = getEffectivePlanKey(tenant);
    const managers = (await findSchedulers(tenantId, excludeUserIds).select("name email phoneE164 smsConsent loginEnabled").lean()).filter(
      (m) => m.loginEnabled !== false && (!only || only(m)),
    );
    const prefs = await Preferences.find({ tenantId, staffId: { $in: managers.map((m) => m._id) } })
      .select("staffId emailNotificationsEnabled smsNotificationsEnabled morningSummaryEnabled")
      .lean();
    const prefOf = new Map(prefs.map((p) => [String(p.staffId), p]));
    const val = (v, m) => (typeof v === "function" ? v(m) : v);
    for (const m of managers) {
      const p = prefOf.get(String(m._id)) || null;
      if (kind === "morning_summary" && p?.morningSummaryEnabled === false) continue;
      const r = await sendToStaff({ tenant, planKey, staff: m, kind, sms: val(sms, m), emailSubject: val(emailSubject, m), emailHtml: val(emailHtml, m), refId, preferences: p });
      out.push({ managerId: String(m._id), ...r });
    }
  } catch (err) {
    console.error("alertManagers failed:", err.message);
  }
  return out;
}

module.exports = { alertManagers, appUrl };
