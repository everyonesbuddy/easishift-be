const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const TimeEntry = require("../models/timeEntryModel");

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }

    await mongoose.connect(process.env.DB_URL);
    console.log("Connected to MongoDB.");

    const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";
    const tenantId = String(process.env.TENANT_ID || "").trim();
    const filter = { qrScan: { $exists: true } };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    const matched = await TimeEntry.countDocuments(filter);
    console.log(`Matched ${matched} time entr${matched === 1 ? "y" : "ies"}.`);

    if (dryRun || matched === 0) {
      if (dryRun) {
        console.log("DRY_RUN=true set. No updates applied.");
      }
      return;
    }

    const result = await TimeEntry.collection.updateMany(filter, {
      $unset: { qrScan: "" },
    });

    console.log(
      `Removed qrScan from ${result.modifiedCount ?? result.nModified ?? 0} time entr${result.modifiedCount === 1 ? "y" : "ies"}.`,
    );
  } catch (err) {
    console.error("Failed to remove qrScan fields:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log("Connection closed.");
  }
}

run();
