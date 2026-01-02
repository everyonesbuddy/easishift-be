const mongoose = require("mongoose");

const preferencesSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    // General preferences (persistent)
    preferredDaysOfWeek: {
      type: [Number], // 0 = Sun ... 6 = Sat
      default: [],
    },

    unavailableDaysOfWeek: {
      type: [Number],
      default: [],
    },

    preferredShiftStart: {
      type: String, // "08:00"
      default: null,
    },

    preferredShiftEnd: {
      type: String, // "17:00"
      default: null,
    },

    maxHoursPerWeek: {
      type: Number,
      default: null,
    },

    minHoursPerWeek: {
      type: Number,
      default: null,
    },

    dislikesNights: {
      type: Boolean,
      default: false,
    },

    prefersBlockScheduling: {
      type: Boolean,
      default: false,
    },
    timezone: {
      type: String,
      default: "UTC",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Preferences", preferencesSchema);
