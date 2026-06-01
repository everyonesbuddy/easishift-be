const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Coverage = require("../models/coverageModel");

const BATCH_SIZE = 500;

const trimValue = (value) => String(value || "").trim();

const hasValue = (value) => trimValue(value).length > 0;

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }

    const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";
    const tenantId = trimValue(process.env.TENANT_ID || "");

    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.DB_URL);
    console.log("Connected.");

    const baseFilter = {};
    if (tenantId) {
      baseFilter.tenantId = tenantId;
    }

    const filter = {
      ...baseFilter,
      $or: [
        {
          shiftType: { $exists: true, $nin: [null, ""] },
          $or: [
            { shiftTag: { $exists: false } },
            { shiftTag: null },
            { shiftTag: "" },
          ],
        },
        {
          shiftTag: { $exists: true, $nin: [null, ""] },
          $or: [
            { shiftType: { $exists: false } },
            { shiftType: null },
            { shiftType: "" },
          ],
        },
      ],
    };

    const total = await Coverage.countDocuments(filter);
    console.log(
      `Matched ${total} coverage record(s) with unpaired shiftType/shiftTag.`,
    );

    const sample = await Coverage.find(filter)
      .select("_id tenantId role date shiftType shiftTag startTime endTime")
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();

    if (sample.length) {
      console.log("Preview (up to 20 rows):");
      for (const row of sample) {
        console.log(
          `- ${row._id} | tenant ${row.tenantId} | role ${row.role} | shiftType=${row.shiftType || "null"} | shiftTag=${row.shiftTag || "null"}`,
        );
      }
    }

    if (dryRun) {
      console.log("DRY_RUN=true set. No updates applied.");
      await mongoose.connection.close();
      console.log("Connection closed.");
      process.exit(0);
    }

    const cursor = Coverage.find(filter)
      .select("_id shiftType shiftTag")
      .lean()
      .cursor();

    const operations = [];
    let processed = 0;
    let fixedTypeOnly = 0;
    let fixedTagOnly = 0;

    for await (const doc of cursor) {
      const hasShiftType = hasValue(doc.shiftType);
      const hasShiftTag = hasValue(doc.shiftTag);

      if (hasShiftType && !hasShiftTag) fixedTypeOnly += 1;
      if (!hasShiftType && hasShiftTag) fixedTagOnly += 1;

      operations.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              shiftType: null,
              shiftTag: null,
            },
          },
        },
      });

      if (operations.length >= BATCH_SIZE) {
        await Coverage.bulkWrite(operations, { ordered: false });
        processed += operations.length;
        operations.length = 0;
      }
    }

    if (operations.length) {
      await Coverage.bulkWrite(operations, { ordered: false });
      processed += operations.length;
    }

    console.log(
      `Updated ${processed} record(s). Cleared type-only: ${fixedTypeOnly}, cleared tag-only: ${fixedTagOnly}.`,
    );

    await mongoose.connection.close();
    console.log("Connection closed.");
    process.exit(0);
  } catch (err) {
    console.error("Failed to normalize coverage shift pairs:", err);
    process.exit(1);
  }
}

run();
