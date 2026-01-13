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

    phone: {
      type: String,
      default: null,
      trim: true,
    },

    address: {
      type: String,
      default: null,
      trim: true,
    },

    // optional: domain for clinic portal login, if you plan multi-hospital web domains
    domain: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
      lowercase: true,
      trim: true,
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
  { timestamps: true }
);

module.exports = mongoose.model("Tenant", tenantSchema);
