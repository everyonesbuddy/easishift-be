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
    passwordHash: {
      type: String,
      required: true,
      select: false, // never return password hash in queries by default
    },
    role: {
      type: String,
      enum: [
        "admin",
        "doctor",
        "nurse",
        "receptionist",
        "billing",
        "staff",
        "rn", // Registered Nurse
        "lpn", // Licensed Practical Nurse
        "cna", // Certified Nursing Assistant
        "med_aide", // Medication Aide / Med Tech
        "caregiver", // Direct Care Worker
        "activity_aide",
        "dietary_aide",
        "housekeeper",
        "other",
      ],
      default: "staff",
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
