// models/scheduleModel.js
const mongoose = require("mongoose");

const scheduleSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Links the schedule back to the coverage slot it fills. Null for ad-hoc
    // shifts created outside any coverage requirement.
    coverageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coverage",
      default: null,
    },
    role: {
      type: String,
      required: true,
      index: true,
      lowercase: true,
      trim: true,
    },
    unitArea: {
      type: String,
      default: null,
    },
    shiftType: {
      type: String,
      default: null,
    },
    shiftTag: {
      type: String,
      default: null,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "scheduled",
        "in_progress",
        "completed",
        "left_early",
        "no_show",
        "call_out",
      ],
      default: "scheduled",
    },
    certificationTags: {
      type: [String],
      default: [],
    },
    notes: { type: String },
    timezone: { type: String, default: "UTC" }, // IANA timezone, for display + auditing
    meta: {
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      publishedAt: Date,
      clockedInAt: Date,
      completedAt: Date,
      leftEarlyAt: Date,
      noShowAt: Date,
    },
  },
  { timestamps: true },
);

// Simple validation: start must be before end
scheduleSchema.pre("validate", function (next) {
  if (this.startTime >= this.endTime) {
    this.invalidate("endTime", "endTime must be after startTime");
  }
  next();
});

// Counting assignments per coverage slot.
scheduleSchema.index({ tenantId: 1, coverageId: 1, status: 1 });
// Calendar/date-range reads and conflict checks.
scheduleSchema.index({ tenantId: 1, startTime: 1, endTime: 1 });
scheduleSchema.index({ tenantId: 1, staffId: 1, startTime: 1 });
scheduleSchema.index({ tenantId: 1, status: 1, startTime: 1 });

module.exports = mongoose.model("Schedule", scheduleSchema);
