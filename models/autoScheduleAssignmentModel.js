const mongoose = require("mongoose");

const autoScheduleAssignmentSchema = new mongoose.Schema(
  {
    runId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AutoScheduleRun",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    coverageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coverage",
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
      lowercase: true,
      trim: true,
      index: true,
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
    shiftTag: {
      type: String,
      default: null,
      index: true,
    },
    certificationTags: {
      type: [String],
      default: [],
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
    timezone: {
      type: String,
      default: "UTC",
    },
    notes: {
      type: String,
      default: "Auto-generated draft",
    },
    state: {
      type: String,
      enum: ["proposed", "removed", "locked"],
      default: "proposed",
      index: true,
    },
    source: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
    warnings: {
      overtimeMinutes: { type: Number, default: 0 },
      consecutiveDaysIfAssigned: { type: Number, default: 0 },
      patternPenalty: { type: Number, default: 0 },
      weekendShiftCount: { type: Number, default: 0 },
      nightShiftCount: { type: Number, default: 0 },
      projectedWeekMinutes: { type: Number, default: 0 },
      preferencePenalty: { type: Number, default: 0 },
    },
    meta: {
      generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      lastEditedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      publishedScheduleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Schedule",
        default: null,
      },
    },
  },
  { timestamps: true },
);

autoScheduleAssignmentSchema.index(
  { runId: 1, coverageId: 1, staffId: 1, startTime: 1, endTime: 1 },
  { unique: true },
);

autoScheduleAssignmentSchema.pre("validate", function (next) {
  if (this.startTime >= this.endTime) {
    this.invalidate("endTime", "endTime must be after startTime");
  }
  next();
});

module.exports = mongoose.model(
  "AutoScheduleAssignment",
  autoScheduleAssignmentSchema,
);
