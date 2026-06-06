const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Tenant = require("../models/tenantModel");

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.DB_URL);
    console.log("Connected.");

    // Backfill legacy tenants with default terms acceptance data.
    const result = await Tenant.updateMany(
      {
        $or: [
          { termsAccepted: { $exists: false } },
          { termsVersion: { $exists: false } },
          { termsAcceptedAt: { $exists: false } },
        ],
      },
      [
        {
          $set: {
            termsAccepted: true,
            termsVersion: "1.0",
            termsAcceptedAt: { $ifNull: ["$termsAcceptedAt", "$createdAt"] },
          },
        },
      ],
    );

    console.log("✔ Terms migration complete.", {
      matched: result.matchedCount ?? 0,
      modified: result.modifiedCount ?? 0,
    });

    await mongoose.connection.close();
    console.log("Connection closed.");
    process.exit(0);
  } catch (err) {
    console.error("Terms migration failed:", err);
    process.exit(1);
  }
}

run();
