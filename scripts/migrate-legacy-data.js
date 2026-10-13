/**
 * One-time migration: existing workspaces → accounts + staff contacts.
 *
 * Before the pivot, everyone was a login user and one person could hold
 * workspace roles (owner/admin/scheduler) and job roles (cna, concierge...)
 * at once. Now:
 *   - Accounts (loginEnabled: true) have exactly ONE workspace role:
 *     owner, scheduler or viewer.
 *   - Staff contacts (loginEnabled: false) have job roles only, and can
 *     have several (e.g. caregiver + med_tech).
 *
 * What it does (only to records that haven't been migrated yet):
 *   1. Each workspace gets exactly one owner: an existing owner, else the
 *      admin whose email is the workspace's email (who signed up), else the
 *      earliest admin/scheduler.
 *   2. Other users with a workspace role become accounts with that one role
 *      ("admin" -> scheduler, "viewer" stays viewer). Any job roles they also
 *      had are dropped (accounts can't be scheduled; add them under Staff
 *      later if they really work shifts).
 *   3. Users with only job roles become staff contacts (keeping all roles).
 *   4. Job roles in use are added to the facility's roles; old tenants are
 *      marked as set up (so they skip onboarding); old paid planKeys map to
 *      the new plan names.
 *   5. Old shifts are marked published, and every week that has shifts is
 *      marked published (so nobody gets re-texted and template needs aren't
 *      added on top of existing schedules).
 *   6. The old global unique index on users.email is dropped (an account and
 *      a staff contact may share an email later) and the new indexes built.
 *
 * Usage:
 *   node scripts/migrate-legacy-data.js            # dry run: prints the plan
 *   node scripts/migrate-legacy-data.js --apply    # makes the changes
 * Reads DB_URL from config.env / the environment. Safe to run again.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "config.env") });
const mongoose = require("mongoose");
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const Schedule = require("../models/scheduleModel");
const ScheduleWeek = require("../models/scheduleWeekModel");
const { buildE164Number } = require("../utils/phone");
const { weekStartFor, dateKeyToCoverageDate, normalizeFacilityTimezone } = require("../utils/dateUtils");

const APPLY = process.argv.includes("--apply");
const ACCOUNT_RANK = { owner: 3, admin: 2, scheduler: 2, viewer: 1 };
const NOT_JOB_ROLES = new Set(["owner", "admin", "scheduler", "viewer", "staff", "user", "other", "patient", ""]);

const norm = (v) =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

const rolesOf = (u) => Array.from(new Set([...(Array.isArray(u.roles) ? u.roles : []), u.role].map(norm).filter(Boolean)));

const LEGACY_PLAN_KEYS = {
  starterMonthly: ["starter", "month"],
  starterYearly: ["starter", "year"],
  growthMonthly: ["growth", "month"],
  growthYearly: ["growth", "year"],
  premiumMonthly: ["premium", "month"],
  premiumYearly: ["premium", "year"],
};

const log = (...args) => console.log(...args);
const summary = { accounts: 0, staff: 0, jobRolesDropped: 0, ownersFixed: 0, tenants: 0, shiftsPublished: 0, weeksPublished: 0, warnings: [] };

async function migrateTenant(tenant) {
  const tenantId = tenant._id;
  log(`\n== ${tenant.name} (${tenantId})`);
  const users = await User.collection.find({ tenantId, loginEnabled: { $exists: false } }).toArray();
  const prefs = await FacilityPreferences.findOne({ tenantId });
  const jobRolesInUse = new Set();

  // Who owns the workspace: an existing owner, else the admin who signed up
  // (their email is the workspace's email), else the earliest admin.
  const existingAccounts = await User.collection.find({ tenantId, loginEnabled: true }).toArray();
  const candidates = [...existingAccounts, ...users].filter((u) => rolesOf(u).some((r) => ACCOUNT_RANK[r]));
  const byAge = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  const tenantEmail = String(tenant.email || tenant.billingEmail || "").toLowerCase();
  const owner =
    candidates.filter((u) => rolesOf(u).includes("owner")).sort(byAge)[0] ||
    candidates.find((u) => tenantEmail && String(u.email || "").toLowerCase() === tenantEmail && rolesOf(u).some((r) => ACCOUNT_RANK[r] >= 2)) ||
    candidates.filter((u) => rolesOf(u).some((r) => ACCOUNT_RANK[r] >= 2)).sort(byAge)[0] ||
    null;
  const ownerId = owner?._id || null;
  if (!owner && candidates.length) summary.warnings.push(`${tenant.name}: no owner, admin or scheduler found`);

  for (const u of users) {
    const roles = rolesOf(u);
    const accountRoles = roles.filter((r) => ACCOUNT_RANK[r]);
    const jobRoles = roles.filter((r) => !NOT_JOB_ROLES.has(r));
    jobRoles.forEach((r) => jobRolesInUse.add(r));
    const phoneE164 = buildE164Number(u.userPhoneCountryCode, u.userPhone) || null;

    if (accountRoles.length) {
      const role = String(u._id) === String(ownerId) ? "owner" : accountRoles.includes("viewer") && !accountRoles.some((r) => ACCOUNT_RANK[r] >= 2) ? "viewer" : "scheduler";
      log(`  account  ${u.name} <${u.email}>: [${roles.join(", ")}] -> ${role}${jobRoles.length ? `  (job roles dropped: ${jobRoles.join(", ")})` : ""}`);
      summary.accounts += 1;
      if (jobRoles.length) {
        summary.jobRolesDropped += 1;
        const shifts = await Schedule.collection.countDocuments({ tenantId, staffId: u._id });
        if (shifts) summary.warnings.push(`${tenant.name}: ${u.name} had ${shifts} shift(s) as staff; they stay in history but ${u.name} won't be offered new shifts unless added under Staff`);
      }
      if (APPLY) {
        await User.collection.updateOne(
          { _id: u._id },
          { $set: { loginEnabled: true, role, roles: [role], status: u.status || "active", phoneE164 } },
        );
      }
    } else {
      if (!jobRoles.length) {
        const fallback = prefs?.roleFamilies?.[0] || "staff";
        summary.warnings.push(`${tenant.name}: ${u.name} had no job role; set to '${fallback}'`);
        jobRoles.push(fallback);
      }
      if (!u.email && !phoneE164) summary.warnings.push(`${tenant.name}: ${u.name} has no email or phone (can't be reached)`);
      log(`  staff    ${u.name} <${u.email || phoneE164 || "no contact"}>: [${jobRoles.join(", ")}]`);
      summary.staff += 1;
      if (APPLY) {
        await User.collection.updateOne(
          { _id: u._id },
          {
            $set: { loginEnabled: false, roles: jobRoles, role: jobRoles[0], status: u.status || "active", phoneE164 },
            $unset: { passwordHash: "", passwordResetToken: "", passwordResetExpires: "" },
          },
        );
      }
    }
  }

  // Anyone already migrated as a second owner becomes a scheduler.
  const extraOwners = existingAccounts.filter((a) => rolesOf(a).includes("owner") && String(a._id) !== String(ownerId));
  if (extraOwners.length) {
    log(`  owner    keep ${owner.name}; ${extraOwners.map((o) => o.name).join(", ")} -> scheduler`);
    summary.ownersFixed += extraOwners.length;
    if (APPLY) await User.collection.updateMany({ _id: { $in: extraOwners.map((o) => o._id) } }, { $set: { role: "scheduler", roles: ["scheduler"] } });
  }

  // Facility roles, setup, plan.
  if (prefs && jobRolesInUse.size) {
    const missing = [...jobRolesInUse].filter((r) => !(prefs.roleFamilies || []).map(norm).includes(r));
    if (missing.length) {
      log(`  roles    add to facility roles: ${missing.join(", ")}`);
      if (APPLY) {
        prefs.roleFamilies = [...(prefs.roleFamilies || []), ...missing];
        await prefs.save({ validateBeforeSave: false });
      }
    }
  }
  const tenantSet = {};
  if (!tenant.setupCompletedAt) tenantSet.setupCompletedAt = new Date();
  const legacy = LEGACY_PLAN_KEYS[tenant.planKey];
  if (legacy && (!tenant.plan || tenant.plan === "free")) {
    tenantSet.plan = legacy[0];
    tenantSet.billingInterval = legacy[1];
    log(`  plan     ${tenant.planKey} -> ${legacy[0]} (${legacy[1]}ly), status ${tenant.subscriptionStatus}`);
  }
  if (Object.keys(tenantSet).length && APPLY) await Tenant.collection.updateOne({ _id: tenantId }, { $set: tenantSet });

  // Old shifts are live; mark their weeks published.
  const unstated = await Schedule.collection.countDocuments({ tenantId, state: { $exists: false } });
  summary.shiftsPublished += unstated;
  if (unstated && APPLY) await Schedule.collection.updateMany({ tenantId, state: { $exists: false } }, { $set: { state: "published" } });
  const timezone = normalizeFacilityTimezone(prefs?.facilityTimezone);
  const weekStartsOn = Number.isInteger(prefs?.weekStartsOn) ? prefs.weekStartsOn : 0;
  const starts = await Schedule.collection.find({ tenantId }, { projection: { startTime: 1 } }).toArray();
  const weekKeys = new Set(starts.filter((s) => s.startTime).map((s) => weekStartFor(new Date(s.startTime), timezone, weekStartsOn)));
  let newWeeks = 0;
  for (const key of weekKeys) {
    const weekStart = dateKeyToCoverageDate(key);
    const exists = await ScheduleWeek.exists({ tenantId, weekStart });
    if (exists) continue;
    newWeeks += 1;
    if (APPLY) {
      await ScheduleWeek.updateOne(
        { tenantId, weekStart },
        { $setOnInsert: { tenantId, weekStart, status: "published", publishedAt: new Date(), generatedAt: new Date() } },
        { upsert: true },
      );
    }
  }
  summary.weeksPublished += newWeeks;
  if (unstated || newWeeks) log(`  shifts   ${unstated} old shifts marked published, ${newWeeks} weeks marked published`);
  summary.tenants += 1;
}

(async () => {
  if (!process.env.DB_URL) throw new Error("DB_URL is not set");
  await mongoose.connect(process.env.DB_URL);
  log(APPLY ? "APPLYING CHANGES" : "DRY RUN (nothing is changed; add --apply to make the changes)");

  // The old schema had a global unique index on email.
  const indexes = await User.collection.indexes().catch(() => []);
  const legacyEmail = indexes.find((i) => i.name === "email_1" && i.unique && !i.partialFilterExpression);
  if (legacyEmail) {
    log("\nindex    drop old unique users.email index (accounts and staff contacts may share an email)");
    if (APPLY) await User.collection.dropIndex("email_1");
  }

  const tenants = await Tenant.collection.find({}).toArray();
  for (const tenant of tenants) await migrateTenant(tenant);

  if (APPLY) {
    try {
      await User.syncIndexes();
      log("\nindex    user indexes rebuilt");
    } catch (err) {
      summary.warnings.push(`Couldn't rebuild user indexes: ${err.message}`);
    }
  }

  log("\nSummary", JSON.stringify({ ...summary, warnings: summary.warnings.length }, null, 2));
  if (summary.warnings.length) {
    log("\nWarnings:");
    summary.warnings.forEach((w) => log(`  - ${w}`));
  }
  if (!APPLY) log("\nNothing was changed. Run again with --apply to migrate.");
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
