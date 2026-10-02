const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Tenant = require("../models/tenantModel");
const {
  buildTenantHostname,
  getNetlifyDomainConfig,
  updateNetlifyTenantAliases,
} = require("../utils/netlifyDomainUtils");

const isDryRun = process.argv.includes("--dry-run");
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
      throw new Error("DB_URL is required");
    }
    const netlifyConfig = getNetlifyDomainConfig();
    if (!netlifyConfig.rootDomain) {
      throw new Error("TENANT_ROOT_DOMAIN is required");
    }
    if (!isDryRun && (!netlifyConfig.siteId || !netlifyConfig.authToken)) {
      throw new Error(
        "NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are required for a live sync",
      );
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

    const tenants = await Tenant.find({
      ...(tenantIds ? { _id: { $in: tenantIds } } : {}),
      subdomain: { $type: "string", $ne: "" },
    })
      .select("name subdomain")
      .sort({ name: 1 })
      .lean();

    if (!tenants.length) {
      console.log("No tenants with subdomains found for sync.");
      return;
    }

    let failed = 0;
    console.log(
      `${isDryRun ? "Would sync" : "Syncing"} ${tenants.length} tenant domain alias(es):`,
    );

    for (const tenant of tenants) {
      const hostname = buildTenantHostname(
        tenant.subdomain,
        netlifyConfig.rootDomain,
      );
      if (!hostname) {
        failed += 1;
        console.error(
          `- ${tenant.name} (${tenant._id}): invalid subdomain or TENANT_ROOT_DOMAIN`,
        );
        continue;
      }

      if (isDryRun) {
        console.log(`- ${tenant.name} (${tenant._id}) -> ${hostname}`);
        continue;
      }

      try {
        const result = await updateNetlifyTenantAliases({
          addSubdomains: [tenant.subdomain],
        });
        console.log(`- ${tenant.name} -> ${hostname}: ${result.status}`);
      } catch (err) {
        failed += 1;
        console.error(
          `- ${tenant.name} -> ${hostname}: ${err && err.message ? err.message : err}`,
        );
      }
    }

    if (isDryRun) {
      console.log("Dry run complete. Rerun without --dry-run to apply.");
    } else {
      console.log(
        `Alias sync complete: ${tenants.length - failed} succeeded, ${failed} failed.`,
      );
      if (failed) process.exitCode = 1;
    }
  } catch (err) {
    console.error("Failed to sync tenant Netlify domains:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
  }
}

run();
