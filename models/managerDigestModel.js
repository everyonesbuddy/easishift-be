const mongoose = require("mongoose");

/** One morning summary per workspace per local day: claimed before sending, so two servers never both send. */
const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    dayKey: { type: String, required: true }, // "2026-11-09" in the facility's time zone
    sent: { type: Number, default: 0 },
  },
  { timestamps: true },
);
schema.index({ tenantId: 1, dayKey: 1 }, { unique: true });

module.exports = mongoose.model("ManagerDigest", schema);
