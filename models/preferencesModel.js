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
