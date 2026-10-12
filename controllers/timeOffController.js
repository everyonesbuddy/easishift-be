// controllers/timeOffController.js
const TimeOff = require("../models/timeOffModel");
const { buildE164Number } = require("../utils/phone");
const { findSchedulers } = require("../utils/schedulers");
const { sendToStaff } = require("../utils/notify");
const { getEffectivePlanKey } = require("../config/plans");
const User = require("../models/userModel");
const Preferences = require("../models/preferencesModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const { sendEmail } = require("../utils/sendEmail");
const { sendSMS } = require("../utils/sendSMS");
const { formatRangeInFacilityZone } = require("../utils/timezoneUtils");
const { hasPermission } = require("../config/authorization");

const getFacilityTimezone = async (tenantId) => {
  const prefs = await FacilityPreferences.findOne({ tenantId })
    .select("facilityTimezone")
    .lean();
  return prefs?.facilityTimezone || "UTC";
};


const isEmailNotificationEnabled = (preferences) =>
  preferences?.emailNotificationsEnabled !== false;

const isSmsNotificationEnabled = (preferences) =>
  preferences?.smsNotificationsEnabled !== false;

// Create request (staff)
exports.requestTimeOff = async (req, res, next) => {
  try {
    const { startTime, endTime, reason } = req.body;
    if (!startTime || !endTime)
      return res
        .status(400)
        .json({ message: "startTime and endTime required" });

    const timeOffRequest = await TimeOff.create({
      tenantId: req.tenantId,
      staffId: req.user._id,
      startTime,
      endTime,
      reason,
    });

    // Notify tenant admins about the new time-off request (best-effort)
    try {
      const facilityTimezone = await getFacilityTimezone(req.tenantId);
      const timeOffWindow = formatRangeInFacilityZone(
        startTime,
        endTime,
        facilityTimezone,
      );
      const admins = await findSchedulers(req.tenantId).select(
        "name email userPhone userPhoneCountryCode",
      );
      if (admins && admins.length) {
        const recipients = admins.map((admin) => admin.email).filter(Boolean);

        if (recipients.length) {
          const subject = `Time-off request: ${req.user.name || req.user._id}`;
          const html = `
            <p>Administrator,</p>
            <p>${req.user.name || "A staff member"} has requested time off:</p>
            <ul>
              <li><strong>Staff:</strong> ${req.user.name || "(unknown)"} &lt;${req.user.email || ""}&gt;</li>
              <li><strong>When:</strong> ${timeOffWindow}</li>
              <li><strong>Reason:</strong> ${reason || "(none)"}</li>
            </ul>
            <p>Please review the request in the admin dashboard.</p>
          `;

          const result = await sendEmail(recipients, subject, html, null, {
            tenantId: req.tenantId,
          });
          if (result && result.success) {
            console.log(
              `Notification email sent to admins for time-off request ${timeOffRequest._id}`,
            );
          } else {
            console.error(
              `Notification email failed for time-off request ${timeOffRequest._id}:`,
              result && result.error ? result.error : "unknown error",
            );
          }
        }

        for (const admin of admins) {
          const adminPhone = buildE164Number(
            admin.userPhoneCountryCode,
            admin.userPhone,
          );
          if (!adminPhone) continue;

          const smsBody = `${req.user.name || "A staff member"} requested time off: ${timeOffWindow}.`;
          const smsResult = await sendSMS(adminPhone, smsBody);
          if (smsResult && smsResult.success) {
            console.log(
              `Notification SMS sent to admin ${adminPhone} for time-off request ${timeOffRequest._id}`,
            );
          } else {
            console.error(
              `Notification SMS failed for admin ${adminPhone} (time-off request ${timeOffRequest._id}):`,
              smsResult && smsResult.error ? smsResult.error : "unknown error",
            );
          }
        }
      }
    } catch (err) {
      console.error(
        `Error sending time-off notifications:`,
        err && err.message ? err.message : err,
      );
    }

    res.status(201).json(timeOffRequest);
  } catch (err) {
    next(err);
  }
};

// Admin: list all requests or staff can list their own
exports.getTimeOff = async (req, res, next) => {
  try {
    const filter = { tenantId: req.tenantId };
    if (req.query.staffId) filter.staffId = req.query.staffId;
    // if not admin, only return own
    if (!hasPermission(req.user, "timeoff.review")) {
      filter.staffId = req.user._id;
    }

    const list = await TimeOff.find(filter).populate("staffId", "name email");
    res.json(list);
  } catch (err) {
    next(err);
  }
};

// Approve / deny (admin)
exports.reviewTimeOff = async (req, res, next) => {
  try {
    const { status } = req.body; // 'approved' or 'denied'
    if (!["approved", "denied"].includes(status))
      return res.status(400).json({ message: "Invalid status" });

    const updated = await TimeOff.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { status, reviewedBy: req.user._id, reviewedAt: new Date() },
      { new: true },
    ).populate("staffId", "name");

    if (!updated) return res.status(404).json({ message: "Request not found" });

    // Notify staff about the decision (best-effort)
    try {
      const facilityTimezone = await getFacilityTimezone(req.tenantId);
      const timeOffWindow = formatRangeInFacilityZone(
        updated.startTime,
        updated.endTime,
        facilityTimezone,
      );
      const updatedStaffId =
        updated.staffId && updated.staffId._id
          ? updated.staffId._id
          : updated.staffId;

      const staff = await User.findOne({
        _id: updatedStaffId,
        tenantId: req.tenantId,
      }).lean();

      if (staff && !staff.loginEnabled) {
        const text = `${req.tenant?.name || "Your facility"}: your time-off request (${timeOffWindow}) was ${status}.`;
        await sendToStaff({
          tenant: req.tenant,
          planKey: getEffectivePlanKey(req.tenant),
          staff,
          kind: "timeoff",
          sms: text,
          emailSubject: `Your time-off request was ${status}`,
          emailHtml: `
            <p>Hi ${staff.name || "there"},</p>
            <p>Your time-off request has been <strong>${status}</strong>.</p>
            <ul><li><strong>When:</strong> ${timeOffWindow}</li></ul>`,
          refId: updated._id,
        });
      }
    } catch (err) {
      console.error(
        `Error sending time-off decision notifications:`,
        err && err.message ? err.message : err,
      );
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
};
