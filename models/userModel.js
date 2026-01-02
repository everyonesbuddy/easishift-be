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
        "other",
      ],
      default: "staff",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
