const mongoose = require("mongoose");

const autoScheduleRunSchema = new mongoose.Schema(
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
      enum: ["draft", "published", "discarded"],
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
  },
  { timestamps: true },
);

autoScheduleRunSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model("AutoScheduleRun", autoScheduleRunSchema);
