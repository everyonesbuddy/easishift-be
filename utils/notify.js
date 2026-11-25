/**
 * Notifications
 * -------------
 * sendToStaff picks the channel, sends, and logs. It never throws.
 *
 *   Paid plan (sms feature) and the person opted in to texts  -> SMS
 *   otherwise, if they have an email                     -> email
 *   otherwise                                            -> not reached (reason)
 *
 * We never text anyone who hasn't opted in first, not even to ask. People
 * opt in themselves: by texting JOIN or START to our number, or by ticking
 * the (unticked) box on their schedule page or, for managers, in Settings.
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

// Our texting number, for "text JOIN to …" in emails and on posters.
const SMS_NUMBER = process.env.SMS_PUBLIC_NUMBER || process.env.TWILIO_PHONE_NUMBER || "+18554498584";
const prettyNumber = (e164) => {
  const d = String(e164 || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
};

// The confirmation after someone opts in on the web (carriers expect frequency, rates, STOP/HELP).
const staffConfirmText = (facilityName, link) =>
  `You're subscribed to WiserShifts schedule texts from ${facilityName}.${link ? ` Your schedule: ${link}` : ""} Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;

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

/**
 * A safety cap on texting per workspace per month, in segments
 * (SMS_MONTHLY_SEGMENT_CAP, default 4000; 0 = no cap). Over it, messages go by
 * email instead until the month turns over. Counted from the logs, cached
 * for 10 minutes per workspace.
 */
const capCache = new Map(); // tenantId → { at, over }
async function overSmsCap(tenantId, now = new Date()) {
  const cap = Number(process.env.SMS_MONTHLY_SEGMENT_CAP ?? 4000);
  if (!cap || !tenantId) return false;
  const key = String(tenantId);
  const hit = capCache.get(key);
  if (hit && now - hit.at < 10 * 60 * 1000) return hit.over;
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await OutboundMessage.aggregate([
    { $match: { tenantId: tenantId, channel: "sms", status: "sent", createdAt: { $gte: monthStart } } },
    { $group: { _id: null, n: { $sum: { $ifNull: ["$segments", 1] } } } },
  ]);
  const over = (row?.n || 0) >= cap;
  if (over && !hit?.over) console.warn(`⚠️ Workspace ${key} reached its monthly texting cap (${cap} segments); sending by email until next month.`);
  capCache.set(key, { at: now, over });
  return over;
}

const logMessage = (entry) =>
  OutboundMessage.create(entry).catch((err) =>
    console.error("Failed to log outbound message:", err.message),
  );

/**
 * @returns {Promise<{delivered:boolean, channel?:"sms"|"email", reason?:string}>}
 * reasons: "no_contact" | "opted_out" | "awaiting_opt_in" | "sms_needs_upgrade"
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

    if (planHasSms && phone && consent === "opted_in" && smsAllowedByStaff && sms && !(await overSmsCap(tenantId))) {
      const result = await sendSMS(phone, sms);
      await logMessage({ ...base, channel: "sms", to: phone, status: result?.success ? "sent" : "failed", segments: result?.segments ?? null, error: result?.success ? null : String(result?.error || "") });
      if (result?.success) return { delivered: true, channel: "sms" };
      // Fall through to email if the text failed.
    }

    if (staff.email && emailAllowedByStaff && emailHtml) {
      const result = await sendEmail(staff.email, emailSubject, emailHtml, null, { tenantId });
      await logMessage({ ...base, channel: "email", to: staff.email, status: result?.success ? "sent" : "failed", error: result?.success ? null : String(result?.error || "") });
      if (result?.success) return { delivered: true, channel: "email" };
      return { delivered: false, reason: "send_failed" };
    }

    if (!phone && !staff.email) return { delivered: false, reason: "no_contact" };
    if (phone && consent === "opted_out") return { delivered: false, reason: "opted_out" };
    if (phone && !planHasSms) return { delivered: false, reason: "sms_needs_upgrade" };
    // A phone, but they haven't opted in yet (we don't text to ask).
    if (phone && planHasSms && (consent === "none" || consent === "pending")) return { delivered: false, reason: "awaiting_opt_in" };
    return { delivered: false, reason: "notifications_off" };
  } catch (err) {
    console.error(`sendToStaff(${kind}) failed for ${staff?._id}:`, err.message);
    return { delivered: false, reason: "send_failed" };
  }
}

/** Email the owner and schedulers (best-effort). */
/**
 * Invite someone to opt in to texts, by email (never by text: carriers
 * require them to opt in before we text them at all). Staff get their
 * schedule link and the JOIN keyword; managers get where to tick the box.
 * Returns { sent, reason }.
 */
async function requestOptIn({ tenant, planKey, person, manager = false }) {
  const phone = person.phoneE164 || null;
  if (!phone) return { sent: false, reason: "no_phone" };
  if (!hasFeature(planKey, "sms")) return { sent: false, reason: "sms_needs_upgrade" };
  const consent = person.smsConsent?.status || "none";
  if (consent === "opted_in") return { sent: false, reason: "already_opted_in" };
  if (consent === "opted_out") return { sent: false, reason: "opted_out" };
  if (!person.email) return { sent: false, reason: "no_email" };
  const number = prettyNumber(SMS_NUMBER);
  let how;
  if (manager) {
    how = `<p>Sign in to WiserShifts, open <strong>Settings → Members</strong>, find yourself and tick <em>Text me alerts</em>. Or text <strong>JOIN</strong> to <strong>${escapeHtml(number)}</strong> from ${escapeHtml(phone)}.</p>`;
  } else {
    const { getStaffLinkUrl } = require("./staffLinks");
    const link = await getStaffLinkUrl(person);
    how = `<p>Open your schedule page and tick <em>Text me my schedule</em>:</p><p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p><p>Or text <strong>JOIN</strong> to <strong>${escapeHtml(number)}</strong> from ${escapeHtml(phone)}.</p>`;
  }
  const html = `<p>Hi ${escapeHtml(firstName(person.name))},</p><p>${escapeHtml(tenant.name)} uses WiserShifts for ${manager ? "call-out and time-off alerts" : "the work schedule"}. If you'd like ${manager ? "those alerts" : "your shifts, reminders and open shifts"} by text:</p>${how}<p>We only text you after you say yes. Message frequency varies; message and data rates may apply. Reply STOP any time to stop.</p>`;
  const result = await sendEmail(person.email, `Get ${tenant.name} ${manager ? "alerts" : "schedule"} texts`, html, null, { tenantId: tenant._id });
  await logMessage({ tenantId: tenant._id, staffId: person._id, kind: "opt_in", refId: null, channel: "email", to: person.email, status: result?.success ? "sent" : "failed", segments: null, error: result?.success ? null : String(result?.error || "") });
  if (!result?.success) return { sent: false, reason: "send_failed" };
  return { sent: true, channel: "email" };
}

/**
 * Record a "yes" someone gave themselves, with what they agreed to and where
 * (that record is the documented opt-in carriers ask for), then send the
 * confirmation text. method: "web_form" | "in_app" | "keyword".
 */
async function recordOptIn({ person, method, wording = null, req = null }) {
  const evidence = {
    at: new Date(),
    method,
    wording: wording ? String(wording).slice(0, 600) : null,
    ip: req ? String(req.headers?.["x-forwarded-for"] || req.ip || "").split(",")[0].trim() || null : null,
    userAgent: req ? String(req.headers?.["user-agent"] || "").slice(0, 300) || null : null,
  };
  await User.updateOne({ _id: person._id }, { $set: { smsConsent: { status: "opted_in", updatedAt: evidence.at, method, evidence } } });
  return evidence;
}

/** After someone opts in from inside the app: the confirmation carriers expect, with how to stop. */
const managerConfirmText = (facilityName) =>
  `You're set: ${facilityName} will text you from WiserShifts when someone calls out or asks for time off, plus a short morning summary. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;

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
  staffConfirmText,
  managerConfirmText,
  requestOptIn,
  recordOptIn,
  SMS_NUMBER,
  prettyNumber,
  logMessage,
  overSmsCap,
  shortShift,
  shortWeek,
  firstName,
  escapeHtml,
};
