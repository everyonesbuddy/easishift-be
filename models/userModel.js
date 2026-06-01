const mongoose = require("mongoose");

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
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
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
    passwordHash: {
      type: String,
      required: true,
      select: false, // never return password hash in queries by default
    },
    role: {
      type: String,
      default: "staff",
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

module.exports = mongoose.model("User", userSchema);
