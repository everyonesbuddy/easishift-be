const mongoose = require("mongoose");

/**
 * CalloutOffer — "we need someone for this shift" sent to eligible staff.
 * The first person to reply YES (or tap the link) gets it.
 */
const recipientSchema = new mongoose.Schema(
  {
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: String,
    phoneE164: { type: String, default: null },
    channel: { type: String, enum: ["sms", "email", null], default: null },
    sentAt: { type: Date, default: null },
    notReachedReason: { type: String, default: null },
    response: {
      type: String,
      enum: ["none", "yes", "too_late"],
      default: "none",
    },
    respondedAt: { type: Date, default: null },
  },
  { _id: false },
);

const calloutOfferSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    coverageId: { type: mongoose.Schema.Types.ObjectId, ref: "Coverage", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: {
      type: String,
      enum: ["open", "filled", "cancelled", "expired"],
      default: "open",
    },
    recipients: { type: [recipientSchema], default: [] },
    filledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    filledAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true }, // the shift's start time
  },
  { timestamps: true },
);

calloutOfferSchema.index({ tenantId: 1, coverageId: 1, status: 1 });
calloutOfferSchema.index({ "recipients.phoneE164": 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("CalloutOffer", calloutOfferSchema);
