const mongoose = require("mongoose");

/** HQ: someone from Facebook to message (commented, reacted, asked), and how it's going. */
const hqFbPersonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    profileUrl: { type: String, trim: true, default: "" },
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "HqFbGroup", default: null }, // null = from our Page
    postUrl: { type: String, trim: true, default: "" },
    said: { type: String, default: "" }, // what they commented
    role: { type: String, trim: true, default: "" }, // scheduler, DON, administrator…
    facility: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["to_message", "messaged", "replied", "call_booked", "signed_up", "not_interested"], default: "to_message" },
    messagedAt: { type: Date, default: null },
    followedUpAt: { type: Date, default: null },
    repliedAt: { type: Date, default: null },
    callAt: { type: Date, default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("HqFbPerson", hqFbPersonSchema);
