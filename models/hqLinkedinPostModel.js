const mongoose = require("mongoose");

/** HQ: a LinkedIn post's numbers, from an uploaded LinkedIn analytics export. */
const hqLinkedinPostSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    author: { type: String, trim: true, default: "" },
    postedAt: { type: Date, default: null },
    text: { type: String, default: "" },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
    reactions: { type: Number, default: 0 },
    comments: { type: Number, default: 0 },
    reposts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

hqLinkedinPostSchema.index({ url: 1 }, { unique: true });

module.exports = mongoose.model("HqLinkedinPost", hqLinkedinPostSchema);
