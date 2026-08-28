const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Tenant = require("../models/tenantModel");

// Tenants that already had access (paid or manually comped) must not receive
// another free trial once billing is enforced.
const PRIOR_ACCESS_FILTER = {
  $and: [
    { $or: [{ trialUsedAt: null }, { trialUsedAt: { $exists: false } }] },
    {
      $or: [
        { stripeSubscriptionId: { $ne: null } },
        { stripeCustomerId: { $ne: null } },
        { subscriptionStatus: { $nin: ["inactive", null] } },
      ],
    },
  ],
};

const isDryRun = process.argv.includes("--dry-run");

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }

    await mongoose.connect(process.env.DB_URL);
    console.log(
      `Connected to database '${mongoose.connection.name}' on '${mongoose.connection.host}'.`,
    );

    const tenants = await Tenant.find(PRIOR_ACCESS_FILTER)
      .select("name subscriptionStatus stripeSubscriptionId createdAt")
      .lean();

    if (!tenants.length) {
      console.log("No tenants need a trialUsedAt backfill.");
      return;
    }

    console.log(`Found ${tenants.length} tenant(s) with prior access:`);
    for (const tenant of tenants) {
      // Backdate to signup so the stamp reflects when free access actually began.
      const trialUsedAt = tenant.createdAt || new Date();
      console.log(
        `- ${tenant.name} (${tenant._id}) status=${tenant.subscriptionStatus} -> trialUsedAt=${trialUsedAt.toISOString()}`,
      );

      if (!isDryRun) {
        await Tenant.updateOne({ _id: tenant._id }, { $set: { trialUsedAt } });
      }
    }

    console.log(
      isDryRun
        ? "Dry run complete. Rerun without --dry-run to apply."
        : `Backfilled trialUsedAt for ${tenants.length} tenant(s).`,
    );
  } catch (err) {
    console.error("Failed to backfill trialUsedAt:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
