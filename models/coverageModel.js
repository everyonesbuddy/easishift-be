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
    startTime: 1,
    endTime: 1,
  },
  { unique: true },
);

module.exports = mongoose.model("Coverage", coverageSchema);
