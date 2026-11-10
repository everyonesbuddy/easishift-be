const mongoose = require("mongoose");

/**
 * HQ customer success: one paying (or chosen) workspace we look after.
 * Health is worked out fresh from the workspace's data; this keeps what
 * people decide: who owns it, which stage it's in, the next check-in, the
 * checklist ticks and the log of calls, visits and notes.
 */
const logSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    kind: { type: String, enum: ["call", "visit", "meeting", "email", "text", "note"], default: "note" },
    text: { type: String, trim: true, default: "" },
    by: { type: String, trim: true, default: "" },
  },
  { _id: true },
);

const hqCustomerSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true },
    owner: { type: String, trim: true, default: "" }, // e.g. "Niah"
    stage: { type: String, enum: ["onboarding", "steady", "at_risk", "renewal", "churned"], default: "onboarding" },
    stageAt: { type: Date, default: Date.now },
    startedAt: { type: Date, default: Date.now }, // when we started looking after them (day 0 of onboarding)
    nextCheckInAt: { type: Date, default: null },
    renewsAt: { type: Date, default: null },
    notes: { type: String, default: "" },
    done: { type: Map, of: Date, default: {} }, // checklist key → when it was ticked
    log: { type: [logSchema], default: [] },
  },
  { timestamps: true },
);

module.exports = mongoose.model("HqCustomer", hqCustomerSchema);
