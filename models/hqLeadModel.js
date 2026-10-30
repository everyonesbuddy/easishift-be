const mongoose = require("mongoose");

/** HQ: an email left on a calculator or other public form. */
const hqLeadSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    source: { type: String, trim: true, default: "" }, // e.g. "calculator:overtime-cost"
    company: { type: String, trim: true, default: "" },
    summary: { type: String, default: "" }, // one line, e.g. "Hours per resident day 3.52"
    newsletter: { type: Boolean, default: false }, // asked for The Labor Math
    utm: { type: Object, default: null },
    klaviyo: {
      synced: { type: Boolean, default: false },
      error: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

hqLeadSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model("HqLead", hqLeadSchema);
