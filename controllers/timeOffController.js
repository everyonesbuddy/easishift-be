// controllers/timeOffController.js
const TimeOff = require("../models/timeOffModel");
const User = require("../models/userModel");
const Preferences = require("../models/preferencesModel");
const { sendEmail } = require("../utils/sendEmail");
const { sendSMS } = require("../utils/sendSMS");

const buildE164Number = (countryCode, phone) => {
  if (!phone) return null;

  const rawPhone = String(phone).trim();
  if (!rawPhone) return null;
  if (rawPhone.startsWith("+")) return rawPhone;

  if (!countryCode) return null;
  const normalizedCountryCode = String(countryCode).trim();
  if (!normalizedCountryCode) return null;

  const prefix = normalizedCountryCode.startsWith("+")
    ? normalizedCountryCode
    : `+${normalizedCountryCode}`;

  return `${prefix}${rawPhone}`;
};

const isTimeOffEmailNotificationEnabled = (preferences) =>
  preferences?.timeOffEmailNotificationsEnabled !== false;

const isTimeOffSmsNotificationEnabled = (preferences) =>
  preferences?.timeOffSmsNotificationsEnabled !== false;

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
      const admins = await User.find({
        tenantId: req.tenantId,
        role: "admin",
      }).select("name email userPhone userPhoneCountryCode");
      if (admins && admins.length) {
        const recipients = admins.map((admin) => admin.email).filter(Boolean);

        if (recipients.length) {
          const subject = `Time-off request: ${req.user.name || req.user._id}`;
          const html = `
            <p>Administrator,</p>
            <p>${req.user.name || "A staff member"} has requested time off:</p>
            <ul>
              <li><strong>Staff:</strong> ${req.user.name || "(unknown)"} &lt;${req.user.email || ""}&gt;</li>
              <li><strong>Start (UTC):</strong> ${new Date(startTime).toUTCString()}</li>
              <li><strong>End (UTC):</strong> ${new Date(endTime).toUTCString()}</li>
              <li><strong>Reason:</strong> ${reason || "(none)"}</li>
            </ul>
            <p>Please review the request in the admin dashboard.</p>
          `;

          const result = await sendEmail(recipients, subject, html);
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

          const smsBody = `${req.user.name || "A staff member"} requested time off. Start (UTC): ${new Date(startTime).toUTCString()}. End (UTC): ${new Date(endTime).toUTCString()}.`;
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
    if (req.user.role !== "admin") filter.staffId = req.user._id;

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
      const updatedStaffId =
        updated.staffId && updated.staffId._id
          ? updated.staffId._id
          : updated.staffId;

      const staff = await User.findById(updatedStaffId).select(
        "name email userPhone userPhoneCountryCode",
      );
      const staffPreference = staff
        ? await Preferences.findOne({
            tenantId: req.tenantId,
            staffId: staff._id,
          })
        : null;

      if (
        staff &&
        staff.email &&
        isTimeOffEmailNotificationEnabled(staffPreference)
      ) {
        const subject = `Your time-off request has been ${status}`;
        const html = `
          <p>Hi ${staff.name || "team member"},</p>
          <p>Your time-off request has been <strong>${status}</strong>.</p>
          <ul>
            <li><strong>Start (UTC):</strong> ${new Date(updated.startTime).toUTCString()}</li>
            <li><strong>End (UTC):</strong> ${new Date(updated.endTime).toUTCString()}</li>
            <li><strong>Reviewed by:</strong> ${req.user.name || req.user._id}</li>
          </ul>
          <p>Please contact your admin if you have questions.</p>
        `;

        const result = await sendEmail(staff.email, subject, html);
        if (result && result.success) {
          console.log(
            `Notification email sent to ${staff.email} for time-off ${updated._id}`,
          );
        } else {
          console.error(
            `Notification email failed for time-off ${updated._id}:`,
            result && result.error ? result.error : "unknown error",
          );
        }
      }

      const to =
        staff && isTimeOffSmsNotificationEnabled(staffPreference)
          ? buildE164Number(staff.userPhoneCountryCode, staff.userPhone)
          : null;
      if (to) {
        const smsBody = `Your time-off request has been ${status}. Start (UTC): ${new Date(updated.startTime).toUTCString()}. End (UTC): ${new Date(updated.endTime).toUTCString()}.`;
        const smsResult = await sendSMS(to, smsBody);
        if (smsResult && smsResult.success) {
          console.log(
            `Notification SMS sent to ${to} for time-off ${updated._id}`,
          );
        } else {
          console.error(
            `Notification SMS failed for ${to} (time-off ${updated._id}):`,
            smsResult && smsResult.error ? smsResult.error : "unknown error",
          );
        }
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
