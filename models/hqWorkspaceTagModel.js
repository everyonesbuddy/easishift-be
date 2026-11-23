const mongoose = require("mongoose");

/**
 * A workspace that isn't a real customer: our own test account, the Apple
 * or Google reviewer's account, a sales demo. Workspaces without a tag are
 * real. Tagged ones stay in the system but HQ leaves them out of customer
 * success, check-ins, signup counts and money.
 */
const schema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, unique: true },
    kind: { type: String, enum: ["test", "app_review", "demo", "other"], required: true },
    note: { type: String, trim: true, default: "" },
    by: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("HqWorkspaceTag", schema);
