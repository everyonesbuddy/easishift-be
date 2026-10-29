/**
 * Create (or reset the password of) an HQ account: WiserShifts' own team.
 * These are NOT workspace accounts; they only open wisershifts.com/hq.
 *
 *   heroku run node scripts/create-hq-user.js joseph@wisershifts.com "Joseph Adeyemo"
 *
 * Prints a new random password once. Sign in at /hq and change it there.
 * Add --disable to turn an account off.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", "config.env") });
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const HqUser = require("../models/hqUserModel");

(async () => {
  const [email, name = ""] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const disable = process.argv.includes("--disable");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.log('Usage: node scripts/create-hq-user.js <email> "<name>" [--disable]');
    process.exit(1);
  }
  await mongoose.connect(process.env.DB_URL);
  const lower = email.trim().toLowerCase();
  if (disable) {
    const r = await HqUser.updateOne({ email: lower }, { $set: { active: false } });
    console.log(r.matchedCount ? `Disabled ${lower}` : `No HQ account for ${lower}`);
  } else {
    const password = crypto.randomBytes(12).toString("base64url");
    const existing = await HqUser.findOne({ email: lower });
    await HqUser.updateOne(
      { email: lower },
      { $set: { passwordHash: await bcrypt.hash(password, 12), active: true, failedLogins: 0, lockedUntil: null, ...(name ? { name } : {}) } },
      { upsert: true },
    );
    console.log(`${existing ? "Reset" : "Created"} HQ account ${lower}`);
    console.log(`Password (shown once): ${password}`);
    console.log("Sign in at https://wisershifts.com/hq/login and change it under your name.");
  }
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
