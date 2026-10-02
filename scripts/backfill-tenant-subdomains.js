const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Tenant = require("../models/tenantModel");
const {
  generateUniqueSubdomain,
  slugifySubdomain,
} = require("../utils/tenantDomainUtils");

const isDryRun = process.argv.includes("--dry-run");
// Optional: --tenant-ids=id1,id2 limits the backfill to specific tenants.
const tenantIdsArg = process.argv.find((arg) =>
  arg.startsWith("--tenant-ids="),
);
const tenantIds = tenantIdsArg
  ? tenantIdsArg
      .slice("--tenant-ids=".length)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  : null;

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }
    if (
      tenantIds &&
      (!tenantIds.length ||
        tenantIds.some((id) => !mongoose.isValidObjectId(id)))
    ) {
      throw new Error(
        "--tenant-ids must be a comma-separated list of ObjectIds",
      );
    }

    await mongoose.connect(process.env.DB_URL);
    console.log(
      `Connected to database '${mongoose.connection.name}' on '${mongoose.connection.host}'.`,
    );

    if (!isDryRun) {
      await Tenant.createIndexes();
      console.log("Ensured Tenant indexes (subdomain unique index).");
    }

    const tenants = await Tenant.find({
      ...(tenantIds ? { _id: { $in: tenantIds } } : {}),
      $or: [
        { subdomain: { $exists: false } },
        { subdomain: null },
        { subdomain: "" },
      ],
    })
      .select("name createdAt")
      .sort({ createdAt: 1 })
      .lean();

    if (!tenants.length) {
      console.log("All tenants already have a subdomain.");
      return;
    }

    // Dry runs don't write, so track names claimed earlier in this run.
    const claimed = new Set();
    console.log(`Found ${tenants.length} tenant(s) without a subdomain:`);

    for (const tenant of tenants) {
      let subdomain = await generateUniqueSubdomain(tenant.name, tenant._id);
      if (claimed.has(subdomain)) {
        const base = slugifySubdomain(tenant.name);
        let suffix = 2;
        while (claimed.has(`${base}-${suffix}`)) suffix += 1;
        subdomain = `${base}-${suffix}`;
      }
      claimed.add(subdomain);

      console.log(`- ${tenant.name} (${tenant._id}) -> ${subdomain}`);

      if (!isDryRun) {
        await Tenant.updateOne({ _id: tenant._id }, { $set: { subdomain } });
      }
    }

    console.log(
      isDryRun
        ? "Dry run complete. Rerun without --dry-run to apply."
        : `Assigned subdomains to ${tenants.length} tenant(s).`,
    );
  } catch (err) {
    console.error("Failed to backfill tenant subdomains:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
