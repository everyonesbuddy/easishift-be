const mongoose = require("mongoose");

/**
 * Every text/email we send to a staff member, for "who wasn't reached",
 * debugging, and matching inbound replies.
 */
const outboundMessageSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    kind: { type: String, required: true },
    channel: { type: String, enum: ["sms", "email"], required: true },
    to: { type: String, required: true },
    status: { type: String, enum: ["sent", "failed"], required: true },
    error: { type: String, default: null },
    // Schedule / coverage / offer / week this message was about.
    refId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

outboundMessageSchema.index({ tenantId: 1, createdAt: -1 });
outboundMessageSchema.index({ to: 1, createdAt: -1 });

module.exports = mongoose.model("OutboundMessage", outboundMessageSchema);
