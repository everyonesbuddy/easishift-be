const mongoose = require("mongoose");

/** HQ content plan: one piece of content, from idea to published (with its numbers once it has a link). */
const hqContentItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    format: { type: String, enum: ["video", "short_video", "linkedin_post", "blog_post", "newsletter", "email", "template", "facebook_post", "other"], default: "other" },
    channel: { type: String, enum: ["youtube", "linkedin", "blog", "newsletter", "facebook", "website", "email", "other"], default: "other" },
    audience: { type: [String], default: [] }, // scheduler | director | operator
    status: { type: String, enum: ["idea", "drafting", "ready", "scheduled", "published"], default: "idea" },
    dueDate: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    url: { type: String, trim: true, default: "" },
    owner: { type: String, trim: true, default: "" },
    notes: { type: String, default: "" },
    playId: { type: mongoose.Schema.Types.ObjectId, ref: "HqPlaybookPlay", default: null },
    seedKey: { type: String, default: null },
  },
  { timestamps: true },
);

hqContentItemSchema.index({ status: 1, dueDate: 1 });
hqContentItemSchema.index({ seedKey: 1 }, { unique: true, partialFilterExpression: { seedKey: { $type: "string" } } });

module.exports = mongoose.model("HqContentItem", hqContentItemSchema);
