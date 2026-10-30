const mongoose = require("mongoose");

/**
 * HQ accounts: WiserShifts' own team (the founders). Completely separate
 * from workspace accounts (User): no tenant, no workspace roles, and an HQ
 * login never opens a workspace. Created with scripts/create-hq-user.js.
 */
const hqUserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, trim: true, default: "" },
    passwordHash: { type: String, required: true, select: false },
    active: { type: Boolean, default: true },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

hqUserSchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model("HqUser", hqUserSchema);
