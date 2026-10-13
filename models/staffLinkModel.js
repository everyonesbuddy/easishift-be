const mongoose = require("mongoose");

/**
 * StaffLink — a staff member's permanent personal link (/s/<token>).
 *
 * The token itself is never stored in plain text: tokenHash (sha256) is used
 * to look it up, tokenEnc (AES-256-GCM with STAFF_LINK_KEY) lets us put the
 * same link in later messages. Rotating revokes the old link.
 */
const staffLinkSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    tokenEnc: { type: String, required: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

staffLinkSchema.index({ staffId: 1, revokedAt: 1 });

module.exports = mongoose.model("StaffLink", staffLinkSchema);
