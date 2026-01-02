// controllers/timeOffController.js
const TimeOff = require("../models/timeOffModel");

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
      { new: true }
    ).populate("staffId", "name");

    if (!updated) return res.status(404).json({ message: "Request not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};
