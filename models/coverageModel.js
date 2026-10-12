const mongoose = require("mongoose");

const coverageSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    // Always stored as start-of-day UTC
    date: {
      type: Date,
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
    },

    endTime: {
      type: Date,
      required: true,
    },

    requiredCount: {
      type: Number,
      default: 1,
      min: 0,
    },

    requiredCertificationTags: {
      type: [String],
      default: [],
    },

    note: { type: String },

    // Where this row came from. "template" rows are generated per week from
    // the StaffingTemplate; "manual" rows were added by hand.
    source: {
      type: String,
      enum: ["template", "manual"],
      default: "manual",
    },
    templateRuleId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    // true once the scheduler changes a template row's count by hand, so
    // later template edits leave that day alone.
    overridden: {
      type: Boolean,
      default: false,
    },
    // Short lock so only one pickup/YES at a time can claim this slot.
    claimLockUntil: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Prevent duplicate coverage/shifts entries for same tenant, date, role, and shift time
coverageSchema.index(
  {
    tenantId: 1,
    date: 1,
    role: 1,
    unitArea: 1,
    shiftType: 1,
    shiftTag: 1,
    startTime: 1,
    endTime: 1,
  },
  { unique: true },
);

// Calendar reads and open-coverage lookups.
coverageSchema.index({ tenantId: 1, date: 1 });
coverageSchema.index({ tenantId: 1, startTime: 1 });

module.exports = mongoose.model("Coverage", coverageSchema);
