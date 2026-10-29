const mongoose = require("mongoose");

/**
 * HQ (internal command center): a building we market to. Imported from the
 * call list, added by hand, or created from a signup. Not a workspace: when
 * the building signs up, `tenantId` links it to its WiserShifts workspace.
 */
const hqFacilitySchema = new mongoose.Schema(
  {
    ref: { type: String, trim: true }, // e.g. "C-0001" from the call list
    name: { type: String, required: true, trim: true },
    city: { type: String, trim: true, default: "" },
    state: { type: String, trim: true, default: "" },
    timeZone: { type: String, trim: true, default: "" },
    facilityType: { type: String, trim: true, default: "" },
    group: { type: String, trim: true, default: "" },
    buildingsInGroup: { type: Number, default: null },
    website: { type: String, trim: true, default: "" },
    domain: { type: String, trim: true, lowercase: true, default: "" },
    frontDeskPhone: { type: String, trim: true, default: "" },
    tier: { type: Number, min: 1, max: 4, default: null },
    score: { type: Number, default: null },
    whyTier: { type: String, default: "" },
    stage: { type: String, trim: true, default: "" },
    attempts: { type: Number, default: 0 },
    lastCallDate: { type: Date, default: null },
    nextStep: { type: String, default: "" },
    nextDate: { type: Date, default: null },
    scheduler: {
      name: { type: String, default: "" },
      title: { type: String, default: "" },
      email: { type: String, lowercase: true, trim: true, default: "" },
      phone: { type: String, default: "" },
    },
    currentTool: { type: String, default: "" },
    biggestPain: { type: String, default: "" },
    notes: { type: String, default: "" },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null },
    source: { type: String, enum: ["crm", "signup", "manual"], default: "manual" },
  },
  { timestamps: true },
);

hqFacilitySchema.index({ ref: 1 }, { unique: true, partialFilterExpression: { ref: { $type: "string", $gt: "" } } });
hqFacilitySchema.index({ tenantId: 1 });
hqFacilitySchema.index({ domain: 1 });
hqFacilitySchema.index({ group: 1 });

module.exports = mongoose.model("HqFacility", hqFacilitySchema);
