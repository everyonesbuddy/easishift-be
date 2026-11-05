const mongoose = require("mongoose");

/**
 * HQ Money: one thing we pay for (Heroku, Postmark…). Its usual cost
 * repeats on its own (monthly, yearly, or once), and any month can be set
 * to what it actually cost.
 */
const hqExpenseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, trim: true, default: "" },
    cadence: { type: String, enum: ["monthly", "yearly", "one_time"], default: "monthly" },
    amount: { type: Number, default: 0 }, // the usual cost, in dollars, per month / per year / once
    startMonth: { type: String, default: "" }, // "2026-01"; empty = from the beginning
    endMonth: { type: String, default: "" }, // "2026-12"; empty = still paying
    months: { type: Map, of: Number, default: {} }, // "2026-03" → what that month actually cost
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("HqExpense", hqExpenseSchema);
