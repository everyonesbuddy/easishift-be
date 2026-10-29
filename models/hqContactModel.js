const mongoose = require("mongoose");

const ROLES = ["executive_director", "administrator", "don", "regional", "owner", "scheduler", "other"];

/** HQ: a person at a facility or group we market to (executives mostly). */
const hqContactSchema = new mongoose.Schema(
  {
    ref: { type: String, trim: true }, // e.g. "L-0001" from the Lead Bank
    name: { type: String, trim: true, default: "" },
    title: { type: String, trim: true, default: "" },
    role: { type: String, enum: ROLES, default: "other" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    linkedin: { type: String, trim: true, default: "" },
    group: { type: String, trim: true, default: "" },
    facilityId: { type: mongoose.Schema.Types.ObjectId, ref: "HqFacility", default: null },
    facilityName: { type: String, trim: true, default: "" },
    priority: { type: String, trim: true, default: "" },
    rep: { type: String, trim: true, default: "" },
    emailReply: { type: String, trim: true, default: "" },
    dealClosed: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    source: { type: String, enum: ["crm", "signup", "manual", "calculator"], default: "manual" },
  },
  { timestamps: true },
);

hqContactSchema.index({ ref: 1 }, { unique: true, partialFilterExpression: { ref: { $type: "string", $gt: "" } } });
hqContactSchema.index({ email: 1 });
hqContactSchema.index({ facilityId: 1 });
hqContactSchema.index({ group: 1 });

module.exports = mongoose.model("HqContact", hqContactSchema);
module.exports.ROLES = ROLES;
