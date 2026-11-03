const mongoose = require("mongoose");

/** HQ: a Facebook group where our buyers talk, and where we stand with it. */
const hqFbGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, trim: true, default: "" },
    audience: { type: [String], enum: ["scheduler", "director", "operator"], default: ["scheduler"] },
    members: { type: Number, default: null },
    region: { type: String, trim: true, default: "" }, // a state or "National"
    allowsPages: { type: String, enum: ["yes", "no", "unknown"], default: "unknown" },
    promo: { type: String, enum: ["unknown", "ask", "thread", "allowed", "none"], default: "unknown" },
    admin: { type: String, trim: true, default: "" },
    priority: { type: Number, min: 1, max: 3, default: 2 }, // 1 = best fit
    status: { type: String, enum: ["found", "requested", "joined", "asked", "approved", "declined", "left"], default: "found" },
    rules: { type: String, default: "" },
    notes: { type: String, default: "" },
    requestedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: null },
    askedAt: { type: Date, default: null },
    adminFollowedUpAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    offerAt: { type: Date, default: null },
    lastAnswerAt: { type: Date, default: null },
    lastTouchAt: { type: Date, default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("HqFbGroup", hqFbGroupSchema);
