/**
 * Shift reminders (paid plans): "Reminder: you work Fri 3p–11p at Sunrise."
 * Runs hourly; each published, scheduled shift gets one reminder roughly
 * `shiftReminderLeadHours` before it starts.
 */
const FacilityPreferences = require("../models/facilityPreferencesModel");
const Tenant = require("../models/tenantModel");
const { DateTime } = require("luxon");
const Schedule = require("../models/scheduleModel");
const { normalizeZone } = require("./timezoneUtils");
const User = require("../models/userModel");
const { getEffectivePlanKey, hasFeature } = require("../config/plans");
const { sendToStaff, shortShift, firstName, escapeHtml } = require("./notify");
const { getStaffLinkUrl } = require("./staffLinks");

const HOUR_MS = 60 * 60 * 1000;

/** Did they have a shift (not called out) the calendar day before this one, in facility time? */
async function workedDayBefore(shift, timezone) {
  const zone = normalizeZone(timezone);
  const day = DateTime.fromJSDate(new Date(shift.startTime)).setZone(zone).startOf("day");
  return Boolean(
    await Schedule.exists({
      tenantId: shift.tenantId,
      staffId: shift.staffId,
      _id: { $ne: shift._id },
      state: "published",
      status: { $in: ["scheduled", "in_progress", "completed", "left_early"] },
      startTime: { $gte: day.minus({ days: 1 }).toJSDate(), $lt: day.toJSDate() },
    }),
  );
}

async function sendShiftReminders(now = new Date()) {
  let sent = 0;
  let skipped = 0;
  const prefsList = await FacilityPreferences.find({})
    .select("tenantId shiftReminderLeadHours shiftReminderMode facilityTimezone")
    .lean();

  for (const prefs of prefsList) {
    const tenant = await Tenant.findById(prefs.tenantId);
    if (!tenant) continue;
    const planKey = getEffectivePlanKey(tenant, now);
    if (!hasFeature(planKey, "reminders")) continue;

    const mode = prefs.shiftReminderMode || "smart";
    if (mode === "off") continue;
    const leadMs = (Number(prefs.shiftReminderLeadHours) || 24) * HOUR_MS;
    const shifts = await Schedule.find({
      tenantId: tenant._id,
      state: "published",
      status: "scheduled",
      startTime: { $gt: new Date(now.getTime() + leadMs - HOUR_MS), $lte: new Date(now.getTime() + leadMs) },
      "meta.reminderSentAt": null,
    }).lean();

    for (const shift of shifts) {
      // Claim it first so two servers never both send.
      const claimed = await Schedule.updateOne(
        { _id: shift._id, "meta.reminderSentAt": null },
        { $set: { "meta.reminderSentAt": now } },
        { timestamps: false },
      );
      if (!claimed.modifiedCount) continue;

      // Smart: no reminder when they worked the day before (they're in a run of shifts and know).
      if (mode === "smart" && (await workedDayBefore(shift, prefs.facilityTimezone))) {
        skipped += 1;
        continue;
      }

      const staff = await User.findOne({
        _id: shift.staffId,
        tenantId: tenant._id,
        loginEnabled: false,
        status: "active",
      }).lean();
      if (!staff) continue;

      const when = shortShift(shift.startTime, shift.endTime, prefs.facilityTimezone);
      const link = await getStaffLinkUrl(staff);
      const result = await sendToStaff({
        tenant,
        planKey,
        staff,
        kind: "reminder",
        sms: `Reminder: you work ${when} at ${tenant.name}. Can't make it? ${link}`,
        emailSubject: `Reminder: you work ${when}`,
        emailHtml: `<p>Hi ${escapeHtml(firstName(staff.name))},</p><p>Reminder: you work <strong>${escapeHtml(when)}</strong> at ${escapeHtml(tenant.name)}.</p><p>Can't make it? <a href="${link}">Let your scheduler know</a>.</p>`,
        refId: shift._id,
      });
      if (result.delivered) sent += 1;
    }
  }
  return { sent, skipped };
}

module.exports = { sendShiftReminders, workedDayBefore };
