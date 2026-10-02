const mongoose = require("mongoose");

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

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
      enum: [
        "starterYearly",
        "growthYearly",
        "premiumYearly",
        "starterMonthly",
        "growthMonthly",
        "premiumMonthly",
        "test",
        null,
      ],
      default: null,
    },

    subscriptionStatus: {
      type: String,
      enum: ["inactive", "trialing", "active", "past_due", "canceled"],
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

    /**
     * Set the first time this tenant starts a trial. Used to make sure a
     * tenant only ever gets one free trial, across any plan or resubscribe.
     */
    trialUsedAt: {
      type: Date,
      default: null,
    },

    /**
     * WHITE-LABEL
     * Tenant portal is served at <subdomain>.<TENANT_ROOT_DOMAIN>.
     */
    subdomain: {
      type: String,
      lowercase: true,
      trim: true,
    },

    branding: {
      displayName: { type: String, trim: true, maxlength: 80, default: null },
      primaryColor: {
        type: String,
        trim: true,
        match: HEX_COLOR_PATTERN,
        default: null,
      },
      secondaryColor: {
        type: String,
        trim: true,
        match: HEX_COLOR_PATTERN,
        default: null,
      },
      // Set when a logo is stored in TenantAsset; doubles as a cache-buster.
      logoUpdatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true },
);

// Partial index so tenants without a subdomain don't collide on null.
tenantSchema.index(
  { subdomain: 1 },
  { unique: true, partialFilterExpression: { subdomain: { $type: "string" } } },
);

module.exports = mongoose.model("Tenant", tenantSchema);
