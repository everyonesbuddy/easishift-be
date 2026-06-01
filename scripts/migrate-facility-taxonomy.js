const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Tenant = require("../models/tenantModel");
const User = require("../models/userModel");
const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const ShiftSwap = require("../models/shiftSwapModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const Preferences = require("../models/preferencesModel");

const DEFAULT_UNIT_AREAS = ["AL", "IL", "MC"];
const DEFAULT_SHIFT_TYPES = ["day", "evening", "night"];

const SILVER_COMET_ROLE_FAMILIES = [
  "doctor",
  "nurse",
  "receptionist",
  "billing",
  "rn",
  "lpn",
  "cna",
  "med_aide",
  "caregiver",
  "activity_aide",
  "dietary_aide",
  "housekeeper",
];

const OLUTAYO_HOSPITAL_ROLE_FAMILIES = [
  "cashier",
  "sales_associate",
  "stock_associate",
  "retail_supervisor",
  "retail_manager",
  "customer_service",
];

const LEGACY_PREFIXES = ["al_", "il_", "mc_"];

const stripLegacyPrefix = (role) => {
  const value = String(role || "")
    .trim()
    .toLowerCase();
  for (const prefix of LEGACY_PREFIXES) {
    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }
  }
  return value;
};

const getLegacyArea = (role) => {
  const value = String(role || "")
    .trim()
    .toLowerCase();
  if (value.startsWith("al_")) return "AL";
  if (value.startsWith("il_")) return "IL";
  if (value.startsWith("mc_")) return "MC";
  return null;
};

const normalizeShiftType = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const normalizeAreaTag = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const inferShiftTypeFromTime = (startTime, endTime) => {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const startHour = start.getUTCHours();
  const crossesMidnight = end.getUTCDate() !== start.getUTCDate();

  if (crossesMidnight || startHour >= 23 || startHour < 7) {
    return "night";
  }

  if (startHour >= 15 && startHour < 23) {
    return "evening";
  }

  return "day";
};

const normalizeStringArray = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );

const normalizeTenantKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getRoleFamilyOverride = (tenant) => {
  const tenantName = normalizeTenantKey(tenant?.name);

  if (tenantName.includes("silver comet")) {
    return SILVER_COMET_ROLE_FAMILIES;
  }

  if (tenantName === "olutayo hospital") {
    return OLUTAYO_HOSPITAL_ROLE_FAMILIES;
  }

  return null;
};

const getUnitAreasOverride = (tenant) => {
  const tenantName = normalizeTenantKey(tenant?.name);

  if (tenantName === "olutayo hospital") {
    return [];
  }

  return null;
};

async function migrateCollection({ model, tenantId, buildUpdate }) {
  const docs = await model.find({ tenantId }).lean();
  if (!docs.length) return { matched: 0, modified: 0 };

  const ops = [];
  for (const doc of docs) {
    const update = buildUpdate(doc);
    if (!update || !Object.keys(update).length) continue;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: update },
      },
    });
  }

  if (!ops.length) return { matched: docs.length, modified: 0 };
  const result = await model.bulkWrite(ops, { ordered: false });
  return {
    matched: docs.length,
    modified: result.modifiedCount || 0,
  };
}

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.DB_URL);
    console.log("Connected.");

    const tenants = await Tenant.find({}).select("_id name email").lean();
    const summary = {
      tenantsProcessed: 0,
      facilityPreferencesUpserted: 0,
      usersModified: 0,
      coveragesModified: 0,
      schedulesModified: 0,
      shiftSwapsModified: 0,
      preferencesModified: 0,
      roleOverridesApplied: 0,
      preferencesLegacyFieldsUnsetGlobal: 0,
    };

    for (const tenant of tenants) {
      summary.tenantsProcessed += 1;

      const [users, coverages, schedules, shiftSwaps, existingFacilityPrefs] =
        await Promise.all([
          User.find({ tenantId: tenant._id })
            .select("role allowedAreas allowedShiftTypes certificationTags")
            .lean(),
          Coverage.find({ tenantId: tenant._id })
            .select(
              "role unitArea shiftType requiredCertificationTags startTime endTime",
            )
            .lean(),
          Schedule.find({ tenantId: tenant._id })
            .select(
              "role unitArea shiftType certificationTags startTime endTime",
            )
            .lean(),
          ShiftSwap.find({ tenantId: tenant._id }).select("role").lean(),
          FacilityPreferences.findOne({ tenantId: tenant._id }).lean(),
        ]);

      const roleFamilySet = new Set();
      const addRoleFamily = (role) => {
        const baseRole = stripLegacyPrefix(role);
        if (baseRole && baseRole !== "admin" && baseRole !== "superadmin") {
          roleFamilySet.add(baseRole);
        }
      };

      users.forEach((doc) => addRoleFamily(doc.role));
      coverages.forEach((doc) => addRoleFamily(doc.role));
      schedules.forEach((doc) => addRoleFamily(doc.role));
      shiftSwaps.forEach((doc) => addRoleFamily(doc.role));

      const facilityUpdate = {};
      const roleOverride = getRoleFamilyOverride(tenant);
      const unitAreasOverride = getUnitAreasOverride(tenant);
      if (
        roleOverride &&
        JSON.stringify(existingFacilityPrefs?.roleFamilies || []) !==
          JSON.stringify(roleOverride)
      ) {
        facilityUpdate.roleFamilies = roleOverride;
        summary.roleOverridesApplied += 1;
      } else if (
        !existingFacilityPrefs ||
        !existingFacilityPrefs.roleFamilies?.length
      ) {
        facilityUpdate.roleFamilies = Array.from(roleFamilySet).sort();
      }
      if (
        unitAreasOverride &&
        JSON.stringify(existingFacilityPrefs?.unitAreas || []) !==
          JSON.stringify(unitAreasOverride)
      ) {
        facilityUpdate.unitAreas = unitAreasOverride;
      } else if (
        !existingFacilityPrefs ||
        !existingFacilityPrefs.unitAreas?.length
      ) {
        facilityUpdate.unitAreas = DEFAULT_UNIT_AREAS;
      }
      if (!existingFacilityPrefs || !existingFacilityPrefs.shiftTypes?.length) {
        facilityUpdate.shiftTypes = DEFAULT_SHIFT_TYPES;
      }
      if (
        !existingFacilityPrefs ||
        !existingFacilityPrefs.certificationTags?.length
      ) {
        facilityUpdate.certificationTags = [];
      }

      await FacilityPreferences.findOneAndUpdate(
        { tenantId: tenant._id },
        { $setOnInsert: { tenantId: tenant._id }, $set: facilityUpdate },
        { upsert: true, new: true, runValidators: true },
      );
      summary.facilityPreferencesUpserted += 1;

      const usersResult = await migrateCollection({
        model: User,
        tenantId: tenant._id,
        buildUpdate: (doc) => {
          const update = {};
          const baseRole = stripLegacyPrefix(doc.role);
          const legacyArea = getLegacyArea(doc.role);
          if (baseRole && baseRole !== doc.role) update.role = baseRole;
          if (legacyArea && !doc.allowedAreas?.length)
            update.allowedAreas = [legacyArea];
          if (!doc.allowedShiftTypes?.length) update.allowedShiftTypes = [];
          if (!doc.certificationTags?.length) update.certificationTags = [];
          return update;
        },
      });
      summary.usersModified += usersResult.modified;

      const coveragesResult = await migrateCollection({
        model: Coverage,
        tenantId: tenant._id,
        buildUpdate: (doc) => {
          const update = {};
          const baseRole = stripLegacyPrefix(doc.role);
          const legacyArea = doc.unitArea || getLegacyArea(doc.role);
          const shiftType =
            normalizeShiftType(doc.shiftType) ||
            inferShiftTypeFromTime(doc.startTime, doc.endTime);

          if (baseRole && baseRole !== doc.role) update.role = baseRole;
          if (
            legacyArea &&
            normalizeAreaTag(doc.unitArea) !== normalizeAreaTag(legacyArea)
          ) {
            update.unitArea = legacyArea;
          }
          if (shiftType && normalizeShiftType(doc.shiftType) !== shiftType) {
            update.shiftType = shiftType;
          }
          if (!doc.requiredCertificationTags?.length)
            update.requiredCertificationTags = [];
          return update;
        },
      });
      summary.coveragesModified += coveragesResult.modified;

      const schedulesResult = await migrateCollection({
        model: Schedule,
        tenantId: tenant._id,
        buildUpdate: (doc) => {
          const update = {};
          const baseRole = stripLegacyPrefix(doc.role);
          const legacyArea = doc.unitArea || getLegacyArea(doc.role);
          const shiftType =
            normalizeShiftType(doc.shiftType) ||
            inferShiftTypeFromTime(doc.startTime, doc.endTime);

          if (baseRole && baseRole !== doc.role) update.role = baseRole;
          if (
            legacyArea &&
            normalizeAreaTag(doc.unitArea) !== normalizeAreaTag(legacyArea)
          ) {
            update.unitArea = legacyArea;
          }
          if (shiftType && normalizeShiftType(doc.shiftType) !== shiftType) {
            update.shiftType = shiftType;
          }
          if (!doc.certificationTags?.length) update.certificationTags = [];
          return update;
        },
      });
      summary.schedulesModified += schedulesResult.modified;

      const swapUpdates = [];
      for (const doc of shiftSwaps) {
        const baseRole = stripLegacyPrefix(doc.role);
        if (baseRole && baseRole !== doc.role) {
          swapUpdates.push({
            updateOne: {
              filter: { _id: doc._id },
              update: { $set: { role: baseRole } },
            },
          });
        }
      }

      if (swapUpdates.length) {
        const swapResult = await ShiftSwap.bulkWrite(swapUpdates, {
          ordered: false,
        });
        summary.shiftSwapsModified += swapResult.modifiedCount || 0;
      }

      const preferencesResult = await migrateCollection({
        model: Preferences,
        tenantId: tenant._id,
        buildUpdate: (doc) => {
          const update = {};

          if (!Array.isArray(doc.preferredDaysOfWeek)) {
            update.preferredDaysOfWeek = [];
          }
          if (typeof doc.scheduleEmailNotificationsEnabled !== "boolean") {
            update.scheduleEmailNotificationsEnabled = true;
          }
          if (typeof doc.scheduleSmsNotificationsEnabled !== "boolean") {
            update.scheduleSmsNotificationsEnabled = true;
          }
          if (typeof doc.timeOffEmailNotificationsEnabled !== "boolean") {
            update.timeOffEmailNotificationsEnabled = true;
          }
          if (typeof doc.timeOffSmsNotificationsEnabled !== "boolean") {
            update.timeOffSmsNotificationsEnabled = true;
          }

          return update;
        },
      });

      const unsetLegacyPreferenceFields = await Preferences.updateMany(
        { tenantId: tenant._id },
        {
          $unset: {
            preferredShiftStart: "",
            preferredShiftEnd: "",
            maxHoursPerWeek: "",
            minHoursPerWeek: "",
            dislikesNights: "",
            prefersBlockScheduling: "",
          },
        },
      );

      summary.preferencesModified +=
        (preferencesResult.modified || 0) +
        (unsetLegacyPreferenceFields.modifiedCount || 0);

      console.log(
        `Tenant ${tenant.name}: users ${usersResult.modified}, coverages ${coveragesResult.modified}, schedules ${schedulesResult.modified}, swaps ${swapUpdates.length ? "updated" : "no_change"}, preferences ${
          (preferencesResult.modified || 0) +
          (unsetLegacyPreferenceFields.modifiedCount || 0)
        }, roleOverride ${roleOverride ? "yes" : "no"}`,
      );
    }

    const globalPreferenceUnset = await Preferences.updateMany(
      {},
      {
        $unset: {
          preferredShiftStart: "",
          preferredShiftEnd: "",
          maxHoursPerWeek: "",
          minHoursPerWeek: "",
          dislikesNights: "",
          prefersBlockScheduling: "",
        },
      },
    );
    summary.preferencesLegacyFieldsUnsetGlobal =
      globalPreferenceUnset.modifiedCount || 0;

    console.log("✔ Migration complete.", summary);
    await mongoose.connection.close();
    console.log("Connection closed.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

run();
