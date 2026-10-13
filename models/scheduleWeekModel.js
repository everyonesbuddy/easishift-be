const mongoose = require("mongoose");

/**
 * ScheduleWeek — one per workspace per week.
 *
 * weekStart is the facility-local first day of the week stored at 00:00Z
 * (same convention as Coverage.date). A week is "draft" until the scheduler
 * publishes it; staff only see published weeks.
 */
const scheduleWeekSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    weekStart: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
    },
    // When Coverage rows were generated from the staffing template.
    generatedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lastPublish: {
      sms: { type: Number, default: 0 },
      email: { type: Number, default: 0 },
      notReached: {
        type: [
          {
            _id: false,
            staffId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            name: String,
            reason: String,
          },
        ],
        default: [],
      },
    },
  },
  { timestamps: true },
);

scheduleWeekSchema.index({ tenantId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model("ScheduleWeek", scheduleWeekSchema);
