const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Preferences = require("../models/preferencesModel");

const LEGACY_NOTIFICATION_FIELDS = {
  scheduleEmailNotificationsEnabled: "",
  scheduleSmsNotificationsEnabled: "",
  timeOffEmailNotificationsEnabled: "",
  timeOffSmsNotificationsEnabled: "",
};

const resolveConsolidatedFlag = (currentValue, legacyValues) => {
  if (typeof currentValue === "boolean") {
    return currentValue;
  }

  if (legacyValues.some((value) => value === false)) {
    return false;
  }

  if (legacyValues.some((value) => value === true)) {
    return true;
  }

  return true;
};

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

    const filter = {
      $or: [
        { emailNotificationsEnabled: { $exists: false } },
        { smsNotificationsEnabled: { $exists: false } },
        { scheduleEmailNotificationsEnabled: { $exists: true } },
        { scheduleSmsNotificationsEnabled: { $exists: true } },
        { timeOffEmailNotificationsEnabled: { $exists: true } },
        { timeOffSmsNotificationsEnabled: { $exists: true } },
      ],
    };

    if (tenantId) {
      filter.tenantId = tenantId;
    }

    const docs = await Preferences.find(filter)
      .select(
        "tenantId staffId emailNotificationsEnabled smsNotificationsEnabled scheduleEmailNotificationsEnabled scheduleSmsNotificationsEnabled timeOffEmailNotificationsEnabled timeOffSmsNotificationsEnabled",
      )
      .lean();

    console.log(`Matched ${docs.length} preference record(s) for migration.`);

    if (!docs.length) {
      await mongoose.connection.close();
      console.log("Connection closed.");
      process.exit(0);
    }

    const preview = docs.slice(0, 20).map((doc) => ({
      id: doc._id,
      emailNotificationsEnabled: resolveConsolidatedFlag(
        doc.emailNotificationsEnabled,
        [
          doc.scheduleEmailNotificationsEnabled,
          doc.timeOffEmailNotificationsEnabled,
        ],
      ),
      smsNotificationsEnabled: resolveConsolidatedFlag(
        doc.smsNotificationsEnabled,
        [
          doc.scheduleSmsNotificationsEnabled,
          doc.timeOffSmsNotificationsEnabled,
        ],
      ),
    }));

    console.log("Sample of resolved preference values:");
    for (const item of preview) {
      console.log(
        `- ${item.id} | email=${item.emailNotificationsEnabled} | sms=${item.smsNotificationsEnabled}`,
      );
    }

    if (dryRun) {
      console.log("DRY_RUN=true set. No updates applied.");
      await mongoose.connection.close();
      console.log("Connection closed.");
      process.exit(0);
    }

    const bulkOps = docs.map((doc) => ({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          $set: {
            emailNotificationsEnabled: resolveConsolidatedFlag(
              doc.emailNotificationsEnabled,
              [
                doc.scheduleEmailNotificationsEnabled,
                doc.timeOffEmailNotificationsEnabled,
              ],
            ),
            smsNotificationsEnabled: resolveConsolidatedFlag(
              doc.smsNotificationsEnabled,
              [
                doc.scheduleSmsNotificationsEnabled,
                doc.timeOffSmsNotificationsEnabled,
              ],
            ),
          },
          $unset: LEGACY_NOTIFICATION_FIELDS,
        },
      },
    }));

    const result = await Preferences.collection.bulkWrite(bulkOps, {
      ordered: false,
    });

    console.log(
      `Updated ${result.modifiedCount || 0} preference record(s). Legacy notification fields removed.`,
    );

    await mongoose.connection.close();
    console.log("Connection closed.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to migrate preference notifications:", err);
    process.exit(1);
  }
}

run();
