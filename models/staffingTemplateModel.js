const mongoose = require("mongoose");

/**
 * StaffingTemplate — one per workspace.
 *
 * "What a normal week needs": for each shift + role, how many people on each
 * weekday. Every new week's Coverage rows are generated from this; the
 * scheduler can still change a single day on the schedule.
 */
const ruleSchema = new mongoose.Schema({
  shiftType: { type: String, required: true, lowercase: true, trim: true },
  shiftTag: { type: String, required: true, lowercase: true, trim: true },
  role: { type: String, required: true, lowercase: true, trim: true },
  unitArea: { type: String, default: null },
  requiredCertificationTags: { type: [String], default: [] },
  // 7 numbers, Sunday = 0 ... Saturday = 6
  countsByWeekday: {
    type: [Number],
    required: true,
    validate: {
      validator: (value) =>
        Array.isArray(value) &&
        value.length === 7 &&
        value.every((n) => Number.isInteger(n) && n >= 0 && n <= 50),
      message: "countsByWeekday must be 7 whole numbers between 0 and 50",
    },
  },
});

const staffingTemplateSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      unique: true,
    },
    rules: { type: [ruleSchema], default: [] },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("StaffingTemplate", staffingTemplateSchema);
