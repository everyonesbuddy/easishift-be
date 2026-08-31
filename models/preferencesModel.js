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

    // ─── SOFT SCHEDULING PREFERENCES ─────────────────────────────────────────
    // These only influence auto-generate ranking. They never block an
    // assignment — hard limits belong on the User record or in TimeOff.

    // Distinct from preferredDaysOfWeek: an empty preferred list means
    // "no opinion", which cannot express "please avoid Sundays".
    avoidDaysOfWeek: {
      type: [Number],
      default: [],
    },

    targetHoursPerWeek: {
      type: Number,
      default: null,
      min: 0,
      max: 168,
    },

    maxShiftsPerWeek: {
      type: Number,
      default: null,
      min: 1,
      max: 7,
    },

    maxConsecutiveDays: {
      type: Number,
      default: null,
      min: 1,
      max: 31,
    },

    // When true, projected overtime stops counting against this staff member.
    wantsOvertime: {
      type: Boolean,
      default: false,
    },

    // ─── BIWEEKLY PREFERENCE ─────────────────────────────────────────────────
    worksEveryOtherWeek: {
      type: Boolean,
      default: false,
    },

    // Defines the first working week when worksEveryOtherWeek is enabled.
    rotationAnchorDate: {
      type: Date,
      default: null,
    },

    emailNotificationsEnabled: {
      type: Boolean,
      default: true,
    },

    smsNotificationsEnabled: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Preferences", preferencesSchema);
