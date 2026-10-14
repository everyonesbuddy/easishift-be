// controllers/timeOffController.js
const TimeOff = require("../models/timeOffModel");
const { DateTime } = require("luxon");
const { buildE164Number } = require("../utils/phone");
const { findSchedulers } = require("../utils/schedulers");
const {
  sendToStaff,
  notifySchedulers,
  escapeHtml,
  firstName,
} = require("../utils/notify");
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
    const { reason } = req.body;
    let { startTime, endTime } = req.body;

    // Whole days: { startDate: "2026-10-20", endDate: "2026-10-21" } means
    // from the start of the first day to the end of the last, facility time.
    const { startDate, endDate } = req.body;
    if (startDate || endDate) {
      const zone = await getFacilityTimezone(req.tenantId);
      const first = DateTime.fromISO(String(startDate || endDate), { zone });
      const last = DateTime.fromISO(String(endDate || startDate), { zone });
      if (!first.isValid || !last.isValid || last < first) {
        return res
          .status(400)
          .json({ message: "startDate and endDate must be YYYY-MM-DD, in order" });
      }
      startTime = first.startOf("day").toUTC().toJSDate();
      endTime = last.plus({ days: 1 }).startOf("day").toUTC().toJSDate();
    }

    if (!startTime || !endTime)
      return res
        .status(400)
        .json({ message: "startTime and endTime (or startDate/endDate) required" });
    if (new Date(endTime) <= new Date(startTime))
      return res
        .status(400)
        .json({ message: "endTime must be after startTime" });

    const timeOffRequest = await TimeOff.create({
      tenantId: req.tenantId,
      staffId: req.user._id,
      startTime,
      endTime,
      reason: reason ? String(reason).slice(0, 500) : undefined,
    });

    // Tell the schedulers (email; best-effort).
    try {
      const facilityTimezone = await getFacilityTimezone(req.tenantId);
      const timeOffWindow = formatRangeInFacilityZone(
        startTime,
        endTime,
        facilityTimezone,
      );
      const staffName = escapeHtml(req.user.name || "A staff member");
      await notifySchedulers({
        tenantId: req.tenantId,
        subject: `Time-off request: ${req.user.name || "staff member"}`,
        html: (person) => `
          <p>Hi ${escapeHtml(firstName(person.name))},</p>
          <p>${staffName} requested time off:</p>
          <ul>
            <li><strong>When:</strong> ${escapeHtml(timeOffWindow)}</li>
            <li><strong>Reason:</strong> ${escapeHtml(reason || "(none)")}</li>
          </ul>
          <p>Review it under Requests in WiserShifts.</p>`,
      });
    } catch (err) {
      console.error(
        "Error notifying schedulers about time off:",
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
