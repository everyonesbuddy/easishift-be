/**
 * The Monday labor email (paid plans). Every Monday around 7 a.m. facility
 * time, owners and admins (plus any extra people listed in Labor settings,
 * e.g. a regional VP) get one page: last week's hours, budget, cost,
 * call-outs and open shifts, plus who's heading into overtime this week,
 * credentials expiring and who's at risk of leaving.
 *
 * Runs hourly; each workspace gets one email per week (claimed on
 * LaborSettings.mondayReport.lastSentWeek so two servers never both send).
 */
const { DateTime } = require("luxon");
const Tenant = require("../models/tenantModel");
const User = require("../models/userModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const LaborSettings = require("../models/laborSettingsModel");
const { getEffectivePlanKey, hasFeature } = require("../config/plans");
const { weekStartFor, addDaysToKey, normalizeFacilityTimezone } = require("./dateUtils");
const { sendEmail } = require("./sendEmail");
const { escapeHtml } = require("./notify");

const SEND_HOUR = 7; // local time, Mondays
const appUrl = () => String(process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const money = (n) => (n === null || n === undefined ? null : `$${Math.round(n).toLocaleString("en-US")}`);
const hrs = (n) => (n === null || n === undefined ? "–" : `${Number(n).toLocaleString("en-US")} h`);
const roleName = (r) => String(r || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const dayName = (key) => DateTime.fromISO(key).toFormat("ccc LLL d");
const rangeLabel = (days) => `${DateTime.fromISO(days[0]).toFormat("LLL d")} – ${DateTime.fromISO(days[6]).toFormat("LLL d")}`;

/** HTML for the email from last week's and this week's reports. */
function buildLaborEmail({ facilityName, last, current }) {
  const row = (label, value, note = "") =>
    `<tr><td style="padding:6px 12px 6px 0;color:#475467">${label}</td><td style="padding:6px 0;font-weight:700">${value}</td><td style="padding:6px 0 6px 12px;color:#667085;font-size:13px">${note}</td></tr>`;
  const section = (title, body) =>
    `<h3 style="margin:24px 0 8px;font-size:16px;color:#101828">${title}</h3>${body}`;
  const list = (items) =>
    items.length ? `<ul style="margin:0;padding-left:18px">${items.map((i) => `<li style="margin:4px 0">${i}</li>`).join("")}</ul>` : `<p style="margin:0;color:#667085">None.</p>`;

  const lastRows = [
    row("Hours scheduled", hrs(last.hours.scheduled)),
    last.hours.worked !== null ? row("Hours worked (time clock)", hrs(last.hours.worked)) : "",
    last.budget ? row("Hours per resident day", last.budget.scheduledPPD,
      last.budget.targetPPD !== null ? `target ${last.budget.targetPPD} · ${last.budget.varianceHours >= 0 ? "+" : ""}${last.budget.varianceHours} h vs budget` : "") : "",
    last.costs && last.costs.scheduled !== null ? row("Labor cost (scheduled)", money(last.costs.scheduled),
      last.costs.overtimePremium ? `incl. ${money(last.costs.overtimePremium)} overtime premium` : "") : "",
    row("Overtime", hrs(last.overtime.totalOvertimeHours), `${last.overtime.people.length} people over ${last.overtime.thresholdHours} h`),
    row("Call-outs / no-shows", `${last.attendance.callOuts} / ${last.attendance.noShows}`,
      last.attendance.byShift[0] ? `most on ${escapeHtml(last.attendance.byShift[0].label)}` : ""),
    row("Shifts missed (ended unfilled)", last.openShifts.unfilledPast, `${last.openShifts.filled} of ${last.openShifts.required} spots filled`),
  ].join("");

  const ot = current.overtime.people.slice(0, 8).map((p) =>
    `<strong>${escapeHtml(p.name)}</strong> (${escapeHtml(roleName(p.role))}): ${p.projectedHours} h, ${p.alreadyOver ? "already over" : `goes over ${dayName(p.crossesOn)}`}`);
  const creds = [...current.credentials.expired, ...current.credentials.expiringSoon].slice(0, 8).map((c) =>
    `<strong>${escapeHtml(c.name)}</strong>: ${escapeHtml(roleName(c.tag))} ${c.daysLeft <= 0 ? "expired" : `expires in ${c.daysLeft} day${c.daysLeft === 1 ? "" : "s"}`}`);
  const watch = current.turnoverWatch.slice(0, 6).map((w) =>
    `<strong>${escapeHtml(w.name)}</strong>: ${w.reasons.map(escapeHtml).join("; ")}`);
  const link = appUrl() ? `<p style="margin:24px 0 0"><a href="${appUrl()}/labor" style="color:#007AFF;font-weight:600">Open the Labor page</a></p>` : "";

  return `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#101828;max-width:620px">
      <h2 style="margin:0 0 4px;font-size:20px">${escapeHtml(facilityName)}: labor for ${rangeLabel(last.days)}</h2>
      <p style="margin:0 0 8px;color:#667085">Your Monday labor report from WiserShifts.</p>
      ${section("Last week", `<table style="border-collapse:collapse;font-size:14px">${lastRows}</table>`)}
      ${section(`Overtime coming this week (over ${current.overtime.thresholdHours} h)`, list(ot))}
      ${section("Credentials expired or expiring in 30 days", list(creds))}
      ${section("Watch list (possible burnout or drifting away)", list(watch))}
      ${link}
    </div>`;
}

/** Owners and admins with an email, plus the extra people in settings. */
async function recipientsFor(tenantId, settings) {
  const members = await User.find({
    tenantId,
    loginEnabled: true,
    status: { $ne: "archived" },
    $or: [{ roles: { $in: ["owner", "administrator"] } }, { role: { $in: ["owner", "administrator"] } }],
  }).select("email").lean();
  return [...new Set([
    ...members.map((m) => m.email),
    ...(settings?.mondayReport?.extraRecipients || []),
  ].filter(Boolean).map((e) => e.toLowerCase()))];
}

/**
 * Builds and sends this week's email for one workspace.
 * force: send even if already sent this week (the "Send it now" button).
 */
async function sendLaborReportForTenant(tenant, { force = false, now = new Date() } = {}) {
  // Required here to avoid a circular require with the controller.
  const { loadLaborReport } = require("../controllers/laborController");
  const tenantId = tenant._id;
  const prefs = await FacilityPreferences.findOne({ tenantId }).select("facilityTimezone weekStartsOn").lean();
  const zone = normalizeFacilityTimezone(prefs?.facilityTimezone);
  const thisWeek = weekStartFor(now, zone, Number.isInteger(prefs?.weekStartsOn) ? prefs.weekStartsOn : 0);

  let settings = await LaborSettings.findOne({ tenantId }).lean();
  if (!force) {
    if (settings?.mondayReport?.enabled === false) return { sent: false, reason: "turned_off" };
    // Claim this week first so two servers never both send.
    const claimed = await LaborSettings.findOneAndUpdate(
      { tenantId, "mondayReport.lastSentWeek": { $ne: thisWeek } },
      { $set: { "mondayReport.lastSentWeek": thisWeek }, $setOnInsert: { tenantId } },
      { upsert: true, new: true },
    ).lean().catch((err) => (err?.code === 11000 ? null : Promise.reject(err)));
    if (!claimed) return { sent: false, reason: "already_sent" };
    settings = claimed;
  }

  const recipients = await recipientsFor(tenantId, settings);
  if (!recipients.length) return { sent: false, reason: "no_recipients" };

  const [last, current] = await Promise.all([
    loadLaborReport({ tenantId, weekStart: addDaysToKey(thisWeek, -7), includeCosts: true, now }),
    loadLaborReport({ tenantId, weekStart: thisWeek, includeCosts: true, now }),
  ]);
  const facilityName = tenant.name || (await Tenant.findById(tenantId).select("name").lean())?.name || "Your facility";
  const html = buildLaborEmail({ facilityName, last, current });
  const subject = `${facilityName}: labor for ${rangeLabel(last.days)}`;
  for (const to of recipients) {
    await sendEmail(to, subject, html, null, { tenantId });
  }
  return { sent: true, sentTo: recipients, weekStart: last.weekStart };
}

/** Hourly: send to every paid workspace where it's Monday ~7 a.m. local. */
async function sendWeeklyLaborReports(now = new Date()) {
  let sent = 0;
  const prefsList = await FacilityPreferences.find({}).select("tenantId facilityTimezone").lean();
  for (const prefs of prefsList) {
    const local = DateTime.fromJSDate(now, { zone: normalizeFacilityTimezone(prefs.facilityTimezone) });
    if (local.weekday !== 1 || local.hour !== SEND_HOUR) continue;
    const tenant = await Tenant.findById(prefs.tenantId);
    if (!tenant || !hasFeature(getEffectivePlanKey(tenant, now), "labor")) continue;
    try {
      const result = await sendLaborReportForTenant(tenant, { now });
      if (result.sent) sent += 1;
    } catch (err) {
      console.error(`🚫 Labor email failed for ${prefs.tenantId}:`, err?.message || err);
    }
  }
  return { sent };
}

module.exports = { buildLaborEmail, sendLaborReportForTenant, sendWeeklyLaborReports, recipientsFor };
