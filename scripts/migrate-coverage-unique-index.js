const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Coverage = require("../models/coverageModel");

const COVERAGE_UNIQUE_KEYS = [
  "tenantId",
  "date",
  "role",
  "unitArea",
  "shiftType",
  "shiftTag",
  "startTime",
  "endTime",
];

const LEGACY_KEY_SETS = [
  [
    "tenantId",
    "date",
    "role",
    "startTime",
    "endTime",
  ],
  [
    "tenantId",
    "date",
    "role",
    "unitArea",
    "shiftType",
    "startTime",
    "endTime",
  ],
];

function hasSameKeys(index, keys) {
  const indexKeys = Object.keys(index.key || {});
  return (
    index.unique === true &&
    indexKeys.length === keys.length &&
    keys.every((key, position) => indexKeys[position] === key)
  );
}

function isCurrentIndex(index) {
  return hasSameKeys(index, COVERAGE_UNIQUE_KEYS);
}

function isLegacyIndex(index) {
  return LEGACY_KEY_SETS.some((keys) => hasSameKeys(index, keys));
}

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }

    console.log(`Connecting to database: ${mongoose.connection.name || "configured DB_URL"}`);
    await mongoose.connect(process.env.DB_URL);
    console.log(
      `Connected to database '${mongoose.connection.name}' on '${mongoose.connection.host}'.`,
    );
    const indexes = await Coverage.collection.indexes();
    console.log("Existing Coverage indexes:");
    for (const index of indexes) {
      console.log(
        `- ${index.name}: ${JSON.stringify(index.key)}${index.unique ? " (unique)" : ""}`,
      );
    }

    const legacyIndexes = indexes.filter(
      (index) => isLegacyIndex(index) && !isCurrentIndex(index),
    );

    for (const index of legacyIndexes) {
      console.log(`Dropping legacy coverage index: ${index.name}`);
      await Coverage.collection.dropIndex(index.name);
    }

    await Coverage.createIndexes();
    console.log(
      legacyIndexes.length
        ? "Coverage unique index migrated to include unitArea."
        : "No legacy coverage index found; coverage indexes are up to date.",
    );
  } catch (err) {
    console.error("Failed to migrate coverage unique index:", err);
    if (err?.code === 11000) {
      console.error(
        "MongoDB found duplicate coverage records while creating the corrected index. Resolve duplicate records, then rerun the migration.",
      );
    } else if (["Unauthorized", "AuthenticationFailed"].includes(err?.codeName)) {
      console.error(
        "The configured MongoDB user may not have permission to list or drop indexes in this database.",
      );
    } else if (["ENOTFOUND", "ECONNREFUSED"].includes(err?.code)) {
      console.error(
        "MongoDB could not be reached. Check DB_URL, network access, and whether the database server is running.",
      );
    }
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();