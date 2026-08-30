const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");

const isDryRun = process.argv.includes("--dry-run");

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const buildMatchKey = (item) =>
  [
    normalize(item.role),
    normalize(item.unitArea),
    normalize(item.shiftType),
    normalize(item.shiftTag),
    new Date(item.startTime).toISOString(),
    new Date(item.endTime).toISOString(),
  ].join("|");

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }

    await mongoose.connect(process.env.DB_URL);
    console.log(
      `Connected to database '${mongoose.connection.name}' on '${mongoose.connection.host}'.`,
    );

    const tenantIds = await Schedule.distinct("tenantId", {
      $or: [{ coverageId: null }, { coverageId: { $exists: false } }],
    });

    if (!tenantIds.length) {
      console.log("No schedules need a coverageId backfill.");
      return;
    }

    let linked = 0;
    let ambiguous = 0;
    let unmatched = 0;

    for (const tenantId of tenantIds) {
      const coverages = await Coverage.find({ tenantId })
        .select("role unitArea shiftType shiftTag startTime endTime")
        .lean();

      // A signature can map to more than one coverage row; those are skipped
      // rather than guessed at.
      const byKey = new Map();
      for (const coverage of coverages) {
        const key = buildMatchKey(coverage);
        if (byKey.has(key)) {
          byKey.set(key, "AMBIGUOUS");
        } else {
          byKey.set(key, coverage._id);
        }
      }

      const schedules = await Schedule.find({
        tenantId,
        $or: [{ coverageId: null }, { coverageId: { $exists: false } }],
      })
        .select("role unitArea shiftType shiftTag startTime endTime")
        .lean();

      const operations = [];
      for (const schedule of schedules) {
        const match = byKey.get(buildMatchKey(schedule));

        if (!match) {
          unmatched += 1;
          continue;
        }
        if (match === "AMBIGUOUS") {
          ambiguous += 1;
          continue;
        }

        operations.push({
          updateOne: {
            filter: { _id: schedule._id },
            update: { $set: { coverageId: match } },
          },
        });
      }

      if (operations.length && !isDryRun) {
        const result = await Schedule.bulkWrite(operations, { ordered: false });
        linked += result.modifiedCount || 0;
      } else {
        linked += operations.length;
      }

      console.log(
        `Tenant ${tenantId}: ${operations.length} schedule(s) linkable of ${schedules.length} unlinked.`,
      );
    }

    console.log(
      `\nLinked: ${linked}  Ambiguous (skipped): ${ambiguous}  No matching coverage: ${unmatched}`,
    );
    console.log(
      isDryRun
        ? "Dry run complete. Rerun without --dry-run to apply."
        : "coverageId backfill complete.",
    );

    if (!isDryRun) {
      await Schedule.syncIndexes();
      await Coverage.syncIndexes();
      console.log("Indexes synced for Schedule and Coverage.");
    }
  } catch (err) {
    console.error("Failed to backfill coverageId:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
