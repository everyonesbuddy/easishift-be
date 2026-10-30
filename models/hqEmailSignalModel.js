const mongoose = require("mongoose");

/**
 * HQ: email engagement per address, synced from Klaviyo. Bot clicks (email
 * security scanners) are counted separately so they don't look like interest.
 */
const hqEmailSignalSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    delivered: { type: Number, default: 0 },
    humanClicks: { type: Number, default: 0 },
    botClicks: { type: Number, default: 0 },
    lastDeliveredAt: { type: Date, default: null },
    lastHumanClickAt: { type: Date, default: null },
    campaignsClicked: { type: [String], default: [] },
    // The most recent real click: which email (campaign or sequence) and which link.
    lastClickCampaign: { type: String, default: "" },
    lastClickUrl: { type: String, default: "" },
    lastClickFromFlow: { type: Boolean, default: false },
    unsubscribed: { type: Boolean, default: false },
    // We stopped emailing them in Klaviyo (suppressed), and why.
    suppressed: { type: Boolean, default: false },
    suppressedAt: { type: Date, default: null },
    suppressReason: { type: String, default: "" },
    suppressedBy: { type: String, default: "" },
  },
  { timestamps: true },
);

hqEmailSignalSchema.index({ email: 1 }, { unique: true });
hqEmailSignalSchema.index({ humanClicks: -1 });

module.exports = mongoose.model("HqEmailSignal", hqEmailSignalSchema);
