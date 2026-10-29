const mongoose = require("mongoose");

/** HQ: something we did with a facility or person (call, email, note). */
const hqActivitySchema = new mongoose.Schema(
  {
    facilityId: { type: mongoose.Schema.Types.ObjectId, ref: "HqFacility", default: null },
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "HqContact", default: null },
    kind: { type: String, enum: ["call", "email", "linkedin", "meeting", "note"], default: "note" },
    outcome: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    nextDate: { type: Date, default: null },
    by: { type: String, trim: true, default: "" },
    importKey: { type: String, default: null },
    // Set when this activity closes a play from the Plays list.
    playKey: { type: String, default: null },
    // Which playbook play this was (for the weekly scoreboard).
    playId: { type: mongoose.Schema.Types.ObjectId, ref: "HqPlaybookPlay", default: null },
  },
  { timestamps: true },
);

hqActivitySchema.index({ facilityId: 1, at: -1 });
hqActivitySchema.index({ contactId: 1, at: -1 });
hqActivitySchema.index({ playId: 1, at: -1 });
hqActivitySchema.index({ playKey: 1 }, { partialFilterExpression: { playKey: { $type: "string" } } });
hqActivitySchema.index({ importKey: 1 }, { unique: true, partialFilterExpression: { importKey: { $type: "string" } } });

module.exports = mongoose.model("HqActivity", hqActivitySchema);
