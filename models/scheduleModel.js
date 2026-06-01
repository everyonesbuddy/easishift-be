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
      index: true,
    },
    shiftType: {
      type: String,
      default: null,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "completed", "call_out"],
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

module.exports = mongoose.model("Schedule", scheduleSchema);
