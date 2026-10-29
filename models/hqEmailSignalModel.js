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
    unsubscribed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

hqEmailSignalSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model("HqEmailSignal", hqEmailSignalSchema);
