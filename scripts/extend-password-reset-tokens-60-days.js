const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const User = require("../models/userModel");

const TARGET_DAYS = 60;
const TARGET_MS = TARGET_DAYS * 24 * 60 * 60 * 1000;

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }

    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.DB_URL);
    console.log("Connected.");

    const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";
    const tenantId = String(process.env.TENANT_ID || "").trim();
    const now = new Date();
    const newExpiry = new Date(now.getTime() + TARGET_MS);

    const filter = {
      passwordResetToken: { $exists: true, $ne: null },
    };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    const totalMatched = await User.countDocuments(filter);
    console.log(`Matched ${totalMatched} user(s) with reset token(s).`);

    const preview = await User.find(filter)
      .select("_id tenantId name email passwordResetExpires")
      .limit(20)
      .lean();

    console.log(
      `Found ${preview.length} sample record(s). Showing up to 20 before update:`,
    );
    for (const user of preview) {
      console.log(
        `- ${user._id} | ${user.email || "(no email)"} | current expiry: ${
          user.passwordResetExpires
            ? new Date(user.passwordResetExpires).toISOString()
            : "(missing)"
        }`,
      );
    }

    if (dryRun) {
      console.log("DRY_RUN=true set. No updates applied.");
      await mongoose.connection.close();
      console.log("Connection closed.");
      process.exit(0);
    }

    const updateResult = await User.updateMany(filter, {
      $set: { passwordResetExpires: newExpiry },
    });

    const modifiedCount = updateResult.modifiedCount ?? updateResult.nModified;

    console.log(
      `Updated ${modifiedCount || 0} user(s). New passwordResetExpires: ${newExpiry.toISOString()}`,
    );

    await mongoose.connection.close();
    console.log("Connection closed.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to extend password reset token expiries:", err);
    process.exit(1);
  }
}

run();