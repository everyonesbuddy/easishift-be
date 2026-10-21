const mongoose = require("mongoose");
const { buildE164Number } = require("../utils/phone");

/**
 * User — two kinds of people share this model:
 *
 *  - Accounts (loginEnabled: true): owner, schedulers, viewers. They sign in
 *    with email + password. roles hold workspace roles (owner/scheduler/viewer).
 *  - Staff contacts (loginEnabled: false): the people being scheduled. No
 *    login; they use a personal link. roles hold facility roles only
 *    (cna, rn, caregiver, ...). Need a name plus a phone or an email.
 */
const userSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },
    userPhone: {
      type: String,
      default: null,
      trim: true,
    },
    userPhoneCountryCode: {
      type: String,
      default: null,
      trim: true,
    },
    // Derived from userPhoneCountryCode + userPhone on save.
    phoneE164: {
      type: String,
      default: null,
    },
    profilePicture: {
      type: String,
      default: null,
      trim: true,
    },
    allowedAreas: {
      type: [String],
      default: [],
    },
    allowedShiftTypes: {
      type: [String],
      default: [],
    },
    certificationTags: {
      type: [String],
      default: [],
    },
    // What this scheduler chose to see on the week view and Weekly Needs
    // (roles and/or unit areas). Empty = everything. Saved per person so it
    // follows them between the website and the app.
    viewFilters: {
      schedule: {
        roles: { type: [String], default: [] },
        areas: { type: [String], default: [] },
      },
      needs: {
        roles: { type: [String], default: [] },
        areas: { type: [String], default: [] },
      },
    },
    passwordHash: {
      type: String,
      select: false, // never return password hash in queries by default
      default: null,
    },
    // Staff link PIN (only used when the facility requires one).
    linkPinHash: { type: String, default: null, select: false },
    linkPinSetAt: { type: Date, default: null },
    linkPinFailures: { type: Number, default: 0 },
    linkPinLockedUntil: { type: Date, default: null },
    // true = can sign in (owner/scheduler/viewer). false = staff contact.
    loginEnabled: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
    smsConsent: {
      status: {
        type: String,
        enum: ["none", "pending", "opted_in", "opted_out"],
        default: "none",
      },
      updatedAt: { type: Date, default: null },
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    role: {
      type: String,
      default: "staff",
      lowercase: true,
      trim: true,
    },
    roles: {
      type: [String],
      default: [],
      lowercase: true,
      trim: true,
    },
    passwordResetToken: {
      type: String,
      select: false,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
    },
  },
  { timestamps: true },
);

userSchema.pre("validate", function (next) {
  if (this.isModified("userPhone") || this.isModified("userPhoneCountryCode")) {
    this.phoneE164 = buildE164Number(this.userPhoneCountryCode, this.userPhone);
  }
  if (this.email === "") this.email = null;

  if (this.loginEnabled && !this.email) {
    this.invalidate("email", "Accounts need an email address");
  }
  if (!this.loginEnabled && !this.email && !this.phoneE164) {
    this.invalidate("userPhone", "Add a phone number or an email address");
  }
  next();
});

// Accounts sign in by email, so their email is unique across the product.
userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: { loginEnabled: true, email: { $type: "string" } },
  },
);
// Staff contacts are unique per workspace by email and by phone, so the same
// nurse can be a contact at two facilities.
userSchema.index(
  { tenantId: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      loginEnabled: false,
      email: { $type: "string" },
    },
  },
);
userSchema.index(
  { tenantId: 1, phoneE164: 1 },
  {
    unique: true,
    partialFilterExpression: {
      loginEnabled: false,
      phoneE164: { $type: "string" },
    },
  },
);
userSchema.index({ phoneE164: 1 }); // inbound SMS lookup
userSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model("User", userSchema);
