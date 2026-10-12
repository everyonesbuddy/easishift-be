const mongoose = require("mongoose");

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const tenantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Contact email for the workspace (the owner's login email lives on User).
    email: {
      type: String,
      required: true,
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
     * FACILITY TYPE
     * Picked during onboarding; drives the default roles, shifts and template.
     */
    facilityType: {
      type: String,
      enum: [
        "assisted_living",
        "memory_care",
        "skilled_nursing",
        "home_care",
        "other",
        null,
      ],
      default: null,
    },

    setupCompletedAt: {
      type: Date,
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
     * PLAN
     * `plan` is the PAID plan from Stripe ("free" until someone pays). The
     * plan a workspace actually gets is computed by getEffectivePlanKey() in
     * config/plans.js from plan + subscriptionStatus + trialEndsAt.
     */
    plan: {
      type: String,
      enum: ["free", "pro", "facility", "organization"],
      default: "free",
    },

    billingInterval: {
      type: String,
      enum: ["month", "year", null],
      default: null,
    },

    foundingMember: {
      type: Boolean,
      default: false,
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
     * PRO TRIAL (opt-in, no card, once per workspace)
     * trialUsedAt: when the owner started it. trialEndsAt: when it ends.
     */
    trialUsedAt: {
      type: Date,
      default: null,
    },

    trialEndsAt: {
      type: Date,
      default: null,
    },

    // Set once each so the trial emails are only sent one time.
    trialReminderSentAt: {
      type: Date,
      default: null,
    },

    trialEndedEmailSentAt: {
      type: Date,
      default: null,
    },

    /**
     * WHITE-LABEL BRANDING (logo + colors used in emails)
     */
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

module.exports = mongoose.model("Tenant", tenantSchema);
