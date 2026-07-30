const mongoose = require("mongoose");

const breakSchema = new mongoose.Schema(
  {
    startAt: {
      type: Date,
      required: true,
    },
    endAt: {
      type: Date,
      default: null,
    },
    type: {
      type: String,
      enum: ["rest", "meal", "other"],
      default: "rest",
    },
    paid: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      enum: ["mobile", "web", "admin"],
      default: "mobile",
    },
  },
  { _id: false },
);

const timeEntrySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    scheduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Schedule",
      default: null,
      index: true,
    },
    clockInAt: {
      type: Date,
      required: true,
      index: true,
    },
    clockOutAt: {
      type: Date,
      default: null,
      index: true,
    },
    breaks: {
      type: [breakSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["in_progress", "completed", "adjusted"],
      default: "in_progress",
      index: true,
    },
    attendanceOutcome: {
      type: String,
      enum: ["in_progress", "completed", "left_early"],
      default: "in_progress",
      index: true,
    },
    mode: {
      type: String,
      enum: ["open", "qr"],
      required: true,
    },
    source: {
      type: String,
      enum: ["mobile", "web", "admin"],
      default: "mobile",
    },
    notes: {
      type: String,
      default: "",
    },
    totals: {
      grossMinutes: { type: Number, default: null },
      unpaidBreakMinutes: { type: Number, default: null },
      workedMinutes: { type: Number, default: null },
    },
    qrScan: {
      tokenId: { type: String, default: null },
      scannedAt: { type: Date, default: null },
    },
    adjustedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    adjustedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

timeEntrySchema.index(
  { tenantId: 1, staffId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "in_progress" },
  },
);

timeEntrySchema.index({ tenantId: 1, staffId: 1, clockInAt: -1 });

timeEntrySchema.pre("validate", function (next) {
  if (this.clockOutAt && this.clockOutAt <= this.clockInAt) {
    this.invalidate("clockOutAt", "clockOutAt must be after clockInAt");
  }

  for (const item of this.breaks || []) {
    if (item.endAt && item.endAt <= item.startAt) {
      this.invalidate("breaks", "break endAt must be after break startAt");
      break;
    }
  }

  next();
});

module.exports = mongoose.model("TimeEntry", timeEntrySchema);
