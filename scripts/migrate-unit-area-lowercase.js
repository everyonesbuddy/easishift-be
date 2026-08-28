const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const AutoScheduleDraft = require("../models/autoScheduleDraftModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");

const HAS_UPPERCASE = /[A-Z]/;

const normalizeAreaTag = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

async function migrateTopLevelUnitArea(Model, label) {
  const docs = await Model.find({ unitArea: { $regex: HAS_UPPERCASE } })
    .select("_id unitArea")
    .lean();

  if (!docs.length) {
    console.log(`${label}: no uppercase unitArea values found.`);
    return;
  }

  const operations = docs.map((doc) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: { unitArea: normalizeAreaTag(doc.unitArea) } },
    },
  }));

  const result = await Model.bulkWrite(operations, { ordered: false });
  console.log(
    `${label}: normalized ${result.modifiedCount || 0} of ${docs.length} document(s).`,
  );
}

async function migrateDraftAssignments() {
  const drafts = await AutoScheduleDraft.find({
    "assignments.unitArea": { $regex: HAS_UPPERCASE },
  }).select("_id assignments.unitArea");

  if (!drafts.length) {
    console.log("AutoScheduleDraft: no uppercase unitArea values found.");
    return;
  }

  let updatedAssignments = 0;
  for (const draft of drafts) {
    let changed = false;
    for (const assignment of draft.assignments || []) {
      if (!assignment.unitArea) continue;
      const normalized = normalizeAreaTag(assignment.unitArea);
      if (normalized !== assignment.unitArea) {
        assignment.unitArea = normalized;
        updatedAssignments += 1;
        changed = true;
      }
    }
    if (changed) await draft.save();
  }

  console.log(
    `AutoScheduleDraft: normalized ${updatedAssignments} assignment(s) across ${drafts.length} draft(s).`,
  );
}

async function migrateFacilityPreferences() {
  const prefs = await FacilityPreferences.find({
    unitAreas: { $regex: HAS_UPPERCASE },
  }).select("_id unitAreas");

  if (!prefs.length) {
    console.log("FacilityPreferences: no uppercase unitAreas values found.");
    return;
  }

  const operations = prefs.map((doc) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: {
        $set: {
          unitAreas: Array.from(
            new Set(
              (doc.unitAreas || []).map(normalizeAreaTag).filter(Boolean),
            ),
          ),
        },
      },
    },
  }));

  const result = await FacilityPreferences.bulkWrite(operations, {
    ordered: false,
  });
  console.log(
    `FacilityPreferences: normalized ${result.modifiedCount || 0} of ${prefs.length} document(s).`,
  );
}

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }

    await mongoose.connect(process.env.DB_URL);
    console.log(
      `Connected to database '${mongoose.connection.name}' on '${mongoose.connection.host}'.`,
    );

    await migrateTopLevelUnitArea(Coverage, "Coverage");
    await migrateTopLevelUnitArea(Schedule, "Schedule");
    await migrateDraftAssignments();
    await migrateFacilityPreferences();

    console.log("unitArea lowercase migration complete.");
  } catch (err) {
    console.error("Failed to migrate unitArea values:", err);
    if (err?.code === 11000) {
      console.error(
        "Lowercasing unitArea produced duplicate Coverage records under the unique index. Resolve the duplicates, then rerun the migration.",
      );
    }
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
