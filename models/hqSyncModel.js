const mongoose = require("mongoose");

/**
 * HQ: one row per outside source (klaviyo, ga4, gsc, youtube, contentful):
 * when it last synced, the cursor for the next incremental pull, the last
 * error, and a cached copy of report data so pages load fast.
 */
const hqSyncSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    lastRunAt: { type: Date, default: null },
    lastOkAt: { type: Date, default: null },
    cursor: { type: String, default: "" },
    error: { type: String, default: "" },
    data: { type: Object, default: null },
    // So two servers never run the same sync at once.
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

hqSyncSchema.index({ key: 1 }, { unique: true });

module.exports = mongoose.model("HqSync", hqSyncSchema);
