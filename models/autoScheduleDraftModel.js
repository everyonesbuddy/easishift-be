const mongoose = require("mongoose");

const draftAssignmentSchema = new mongoose.Schema(
  {
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      default: () => new mongoose.Types.ObjectId(),
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
      enum: ["proposed", "removed", "locked", "published"],
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
    publishedScheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Schedule",
      default: null,
    },
  },
  { _id: false },
);

const autoScheduleDraftSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["draft", "partially_published", "published", "discarded"],
      default: "draft",
      index: true,
    },
    coverageIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Coverage" }],
      default: [],
    },
    policySource: {
      type: String,
      enum: ["facility_preferences", "defaults"],
      default: "defaults",
    },
    facilityPolicy: {
      schedulingPattern: { type: String, default: "balance" },
      weeklyOvertimeThresholdHours: { type: Number, default: 40 },
      fairnessLookbackDays: { type: Number, default: 28 },
    },
    summary: {
      requestedCoverageIds: { type: Number, default: 0 },
      processedCoverageCount: { type: Number, default: 0 },
      generatedAssignmentCount: { type: Number, default: 0 },
      filledCoverageCount: { type: Number, default: 0 },
      partiallyFilledCoverageCount: { type: Number, default: 0 },
      skippedCoverageCount: { type: Number, default: 0 },
      alreadyFilledCoverageCount: { type: Number, default: 0 },
    },
    assignments: {
      type: [draftAssignmentSchema],
      default: [],
    },
    publishedAt: { type: Date, default: null },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    discardedAt: { type: Date, default: null },
    discardedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastEditedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

autoScheduleDraftSchema.index({ tenantId: 1, createdAt: -1 });
autoScheduleDraftSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("AutoScheduleDraft", autoScheduleDraftSchema);
