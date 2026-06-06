const mongoose = require("mongoose");

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    tenantPhone: {
      type: String,
      default: null,
      trim: true,
    },

    tenantPhoneCountryCode: {
      type: String,
      default: null,
      trim: true,
    },

    address: {
      type: String,
      default: null,
      trim: true,
    },

    /**
     * INDUSTRY
     * Type of business the tenant operates
     */
    industry: {
      type: String,
      enum: [
        "Healthcare",
        "Senior Living",
        "Retail",
        "Hospitality",
        "Manufacturing",
        "Education",
        "Transportation",
        "Finance",
        "Police",
        "Warehouse and Logistics",
        "Security Service",
        "Other",
      ],
      default: null,
    },

    /**
     * TERMS AND CONDITIONS
     * Captures whether tenant accepted terms and which version.
     */
    termsAccepted: {
      type: Boolean,
      default: false,
    },

    termsVersion: {
      type: String,
      default: null,
      trim: true,
    },

    termsAcceptedAt: {
      type: Date,
      default: null,
    },

    /**
     * PLAN / LIMITS
     * Seat = a user with a login (admin/staff).
     * Default 1 because signup creates an admin user.
     */
    seatLimit: {
      type: Number,
      default: 1,
      min: 1,
    },

    // The active plan after payment. Keep null until active.
    planKey: {
      type: String,
      enum: ["starter", "growth", "premium", "test", null],
      default: null,
    },

    subscriptionStatus: {
      type: String,
      enum: ["inactive", "active", "past_due", "canceled"],
      default: "inactive",
      index: true,
    },

    /**
     * BILLING (Stripe)
     * Filled after checkout/webhook.
     */
    billingEmail: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },

    stripeCustomerId: {
      type: String,
      default: null,
      index: true,
    },

    stripeSubscriptionId: {
      type: String,
      default: null,
      index: true,
    },

    stripePriceId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Tenant", tenantSchema);
