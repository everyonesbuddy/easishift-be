const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const User = require("../models/userModel");

const EXTENSION_DAYS = 14;
const EXTENSION_MS = EXTENSION_DAYS * 24 * 60 * 60 * 1000;

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }

    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.DB_URL);
    console.log("Connected.");

    const now = new Date();
    const newExpiry = new Date(now.getTime() + EXTENSION_MS);
    const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";
    const tenantId = String(process.env.TENANT_ID || "").trim();

    const filter = {
      passwordResetToken: { $exists: true, $ne: null },
      passwordResetExpires: { $exists: true, $lt: now },
    };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    const totalExpired = await User.countDocuments(filter);
    console.log(`Matched ${totalExpired} expired reset record(s).`);

    const preview = await User.find(filter)
      .select("_id tenantId name email passwordResetExpires")
      .limit(20)
      .lean();

    console.log(
      `Found ${preview.length} sample expired reset record(s). Showing up to 20:`,
    );
    for (const user of preview) {
      console.log(
        `- ${user._id} | ${user.email || "(no email)"} | expired at ${new Date(
          user.passwordResetExpires,
        ).toISOString()}`,
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
    console.error("Failed to extend expired password reset windows:", err);
    process.exit(1);
  }
}

run();
