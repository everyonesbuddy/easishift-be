/**
 * Notifications
 * -------------
 * sendToStaff picks the channel, sends, and logs. It never throws.
 *
 *   Pro+ (sms feature) and the person opted in to texts  -> SMS
 *   otherwise, if they have an email                     -> email
 *   Pro+ with a phone but no answer yet                  -> one opt-in text
 *   otherwise                                            -> not reached (reason)
 *
 * notifySchedulers emails the owner and schedulers.
 */
const { DateTime } = require("luxon");
const User = require("../models/userModel");
const Preferences = require("../models/preferencesModel");
const OutboundMessage = require("../models/outboundMessageModel");
const { sendSMS } = require("./sendSMS");
const { sendEmail } = require("./sendEmail");
const { findSchedulers } = require("./schedulers");
const { hasFeature } = require("../config/plans");
const { normalizeZone } = require("./timezoneUtils");

const optInText = (facilityName) =>
  `${facilityName} uses WiserShifts to send your work schedule. Reply START to get schedule texts. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// "7a", "3:30p"
const shortTime = (dt) =>
  `${dt.toFormat(dt.minute ? "h:mm" : "h")}${dt.hour < 12 ? "a" : "p"}`;

/** "Fri Oct 16, 3p–11p" in the facility's zone. */
const shortShift = (start, end, timezone) => {
  const zone = normalizeZone(timezone);
  const s = DateTime.fromJSDate(new Date(start)).setZone(zone);
  const e = DateTime.fromJSDate(new Date(end)).setZone(zone);
  return `${s.toFormat("ccc LLL d")}, ${shortTime(s)}–${shortTime(e)}`;
};

/** "Oct 11–17" or "Oct 26–Nov 1" */
const shortWeek = (startKey) => {
  const s = DateTime.fromISO(startKey, { zone: "UTC" });
  const e = s.plus({ days: 6 });
  return s.month === e.month
    ? `${s.toFormat("LLL d")}–${e.toFormat("d")}`
    : `${s.toFormat("LLL d")}–${e.toFormat("LLL d")}`;
};

const logMessage = (entry) =>
  OutboundMessage.create(entry).catch((err) =>
    console.error("Failed to log outbound message:", err.message),
  );

/**
 * @returns {Promise<{delivered:boolean, channel?:"sms"|"email", reason?:string}>}
 * reasons: "no_contact" | "opted_out" | "awaiting_opt_in" | "sms_needs_pro"
 *          | "notifications_off" | "send_failed"
 */
async function sendToStaff({
  tenant,
  planKey,
  staff,
  kind,
  sms,
  emailSubject,
  emailHtml,
  refId = null,
  preferences, // optional pre-loaded Preferences doc
}) {
  try {
    const tenantId = tenant._id;
    const prefs =
      preferences !== undefined
        ? preferences
        : await Preferences.findOne({ tenantId, staffId: staff._id })
            .select("emailNotificationsEnabled smsNotificationsEnabled")
            .lean();
    const smsAllowedByStaff = prefs?.smsNotificationsEnabled !== false;
    const emailAllowedByStaff = prefs?.emailNotificationsEnabled !== false;

    const planHasSms = hasFeature(planKey, "sms");
    const phone = staff.phoneE164 || null;
    const consent = staff.smsConsent?.status || "none";
    const base = { tenantId, staffId: staff._id, kind, refId };

    if (planHasSms && phone && consent === "opted_in" && smsAllowedByStaff && sms) {
      const result = await sendSMS(phone, sms);
      await logMessage({ ...base, channel: "sms", to: phone, status: result?.success ? "sent" : "failed", error: result?.success ? null : String(result?.error || "") });
      if (result?.success) return { delivered: true, channel: "sms" };
      // Fall through to email if the text failed.
    }

    // On a texting plan, ask anyone with a phone who hasn't answered yet to
    // opt in (once). Happens alongside email for people who have both.
    const canAskOptIn =
      planHasSms && phone && consent === "none" && smsAllowedByStaff;
    const askOptIn = async () => {
      const result = await sendSMS(phone, optInText(tenant.name));
      await logMessage({ ...base, kind: "opt_in", channel: "sms", to: phone, status: result?.success ? "sent" : "failed", error: result?.success ? null : String(result?.error || "") });
      if (result?.success) {
        await User.updateOne(
          { _id: staff._id },
          { $set: { smsConsent: { status: "pending", updatedAt: new Date() } } },
        );
      }
    };

    if (staff.email && emailAllowedByStaff && emailHtml) {
      const result = await sendEmail(staff.email, emailSubject, emailHtml, null, { tenantId });
      await logMessage({ ...base, channel: "email", to: staff.email, status: result?.success ? "sent" : "failed", error: result?.success ? null : String(result?.error || "") });
      if (canAskOptIn) await askOptIn();
      if (result?.success) return { delivered: true, channel: "email" };
      return { delivered: false, reason: "send_failed" };
    }

    if (canAskOptIn) {
      await askOptIn();
      return { delivered: false, reason: "awaiting_opt_in" };
    }

    if (!phone && !staff.email) return { delivered: false, reason: "no_contact" };
    if (phone && consent === "opted_out") return { delivered: false, reason: "opted_out" };
    if (phone && !planHasSms) return { delivered: false, reason: "sms_needs_pro" };
    if (phone && consent === "pending") return { delivered: false, reason: "awaiting_opt_in" };
    return { delivered: false, reason: "notifications_off" };
  } catch (err) {
    console.error(`sendToStaff(${kind}) failed for ${staff?._id}:`, err.message);
    return { delivered: false, reason: "send_failed" };
  }
}

/** Email the owner and schedulers (best-effort). */
async function notifySchedulers({ tenantId, subject, html, excludeUserIds = [] }) {
  try {
    const schedulers = await findSchedulers(tenantId, excludeUserIds)
      .select("name email loginEnabled")
      .lean();
    for (const person of schedulers) {
      if (!person.email || person.loginEnabled === false) continue;
      await sendEmail(person.email, subject, html(person), null, { tenantId });
    }
  } catch (err) {
    console.error("notifySchedulers failed:", err.message);
  }
}

module.exports = {
  sendToStaff,
  notifySchedulers,
  optInText,
  shortShift,
  shortWeek,
  firstName,
  escapeHtml,
};
