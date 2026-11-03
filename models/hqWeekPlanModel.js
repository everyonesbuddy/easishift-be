const mongoose = require("mongoose");

/**
 * HQ: this week's checklist, one per week (Monday's date). Made the first
 * time the week is opened so it stays put all week; refills only add.
 */
const todoSchema = new mongoose.Schema({
  playId: { type: mongoose.Schema.Types.ObjectId, ref: "HqPlaybookPlay", default: null },
  kind: { type: String, enum: ["facility", "contact", "content", "task", "fbgroup", "fbperson"], required: true },
  action: { type: String, default: "" }, // Facebook: the step (join, admin, offer, answer, message…)
  url: { type: String, default: "" },
  refId: { type: mongoose.Schema.Types.ObjectId, default: null }, // the facility, person, content piece or Facebook group / person
  facilityId: { type: mongoose.Schema.Types.ObjectId, ref: "HqFacility", default: null },
  title: { type: String, default: "" },
  detail: { type: String, default: "" },
  phone: { type: String, default: "" },
  email: { type: String, default: "" },
  day: { type: Number, min: 0, max: 6, default: null }, // 0 = Monday; null = any day this week
  done: { type: Boolean, default: false }, // tasks; other kinds are read from what was logged or published
  doneAt: { type: Date, default: null },
  activityId: { type: mongoose.Schema.Types.ObjectId, ref: "HqActivity", default: null }, // the touch a tick logged
  prevStatus: { type: String, default: "" }, // a content piece's status before the tick, for undo
  prevLastCall: { type: Date, default: null },
  added: { type: Boolean, default: false }, // added by hand or ticked from "more"
});

const hqWeekPlanSchema = new mongoose.Schema(
  {
    weekKey: { type: String, required: true, unique: true },
    items: { type: [todoSchema], default: [] },
    removed: { type: [String], default: [] }, // refIds taken off the list (refills don't bring them back)
  },
  { timestamps: true },
);

module.exports = mongoose.model("HqWeekPlan", hqWeekPlanSchema);
