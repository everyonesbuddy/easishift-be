// controllers/timeOffController.js
const TimeOff = require("../models/timeOffModel");
const User = require("../models/userModel");
const { sendEmail } = require("../utils/sendEmail");

// Create request (staff)
exports.requestTimeOff = async (req, res, next) => {
  try {
    const { startTime, endTime, reason } = req.body;
    if (!startTime || !endTime)
      return res
        .status(400)
        .json({ message: "startTime and endTime required" });

    const to = await TimeOff.create({
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
      }).select("name email");
      if (admins && admins.length) {
        const recipients = admins.map((a) => a.email).filter(Boolean);
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
              `Notification email sent to admins for time-off request ${to._id}`,
            );
          } else {
            console.error(
              `Notification email failed for time-off request ${to._id}:`,
              result && result.error ? result.error : "unknown error",
            );
          }
        }
      }
    } catch (err) {
      console.error(
        `Error sending time-off notification emails:`,
        err && err.message ? err.message : err,
      );
    }

    res.status(201).json(to);
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
      const staff = await User.findById(updated.staffId).select("name email");
      if (staff && staff.email) {
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
    } catch (err) {
      console.error(
        `Error sending time-off decision email:`,
        err && err.message ? err.message : err,
      );
    }

    res.json(updated);
  } catch (err) {
    next(err);
  }
};
