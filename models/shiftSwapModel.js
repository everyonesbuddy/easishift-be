const mongoose = require("mongoose");

const shiftSwapSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    scheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Schedule",
      required: true,
      index: true,
    },
    requesterStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    receiverStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
      index: true,
    },
    shiftStartTime: {
      type: Date,
      required: true,
    },
    shiftEndTime: {
      type: Date,
      required: true,
    },
    requestNote: {
      type: String,
      default: "",
    },
    responseNote: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "denied", "cancelled", "expired"],
      default: "pending",
      index: true,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

shiftSwapSchema.index(
  { tenantId: 1, scheduleId: 1, receiverStaffId: 1, status: 1 },
  { partialFilterExpression: { status: "pending" } },
);

module.exports = mongoose.model("ShiftSwap", shiftSwapSchema);
