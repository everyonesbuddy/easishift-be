const mongoose = require("mongoose");

/**
 * StaffDevice — a phone or computer where a staff member entered their
 * link PIN. The browser keeps a random device token; we store only its
 * sha256. Resetting the PIN or signing out revokes it.
 */
const staffDeviceSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true, unique: true },
    userAgent: { type: String, default: null },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

staffDeviceSchema.index({ staffId: 1, revokedAt: 1 });

module.exports = mongoose.model("StaffDevice", staffDeviceSchema);
