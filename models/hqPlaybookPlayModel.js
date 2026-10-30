const mongoose = require("mongoose");

/**
 * HQ playbook: one play (who it's for, the channel, the steps and scripts, a
 * weekly target). The scoreboard counts what's been done against the target:
 * touches logged with this play, content published for it, or calculator
 * emails / signups (countsFrom).
 */
const scriptSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: "" },
    subject: { type: String, trim: true, default: "" },
    body: { type: String, default: "" },
  },
  { _id: false },
);

const hqPlaybookPlaySchema = new mongoose.Schema(
  {
    order: { type: Number, default: 0 },
    seedKey: { type: String, default: null },
    title: { type: String, required: true, trim: true },
    channel: { type: String, enum: ["calls", "email", "linkedin", "newsletter", "youtube", "blog", "facebook", "search", "other"], default: "other" },
    audience: { type: [String], default: [] }, // scheduler | director | operator
    who: { type: String, default: "" },
    goal: { type: String, default: "" },
    when: { type: String, default: "" },
    steps: { type: [String], default: [] },
    scripts: { type: [scriptSchema], default: [] },
    volume: { type: String, default: "" },
    weeklyTarget: { type: Number, default: null },
    targetUnit: { type: String, default: "" },
    countsFrom: { type: String, enum: ["activities", "content", "leads", "signups", "none"], default: "activities" },
    measure: { type: String, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

hqPlaybookPlaySchema.index({ order: 1 });
hqPlaybookPlaySchema.index({ seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: "string" } } });

module.exports = mongoose.model("HqPlaybookPlay", hqPlaybookPlaySchema);
