/**
 * Finds workspaces made by signup bots and (with --delete) removes them.
 *
 *   node scripts/cleanup-spam-signups.js            # list only
 *   node scripts/cleanup-spam-signups.js --delete   # remove what it lists
 *
 * A workspace is listed only when ALL of these hold:
 *   - its name or its owner's name is a random mixed-case string
 *     (utils/signupGuard looksLikeGibberish)
 *   - setup was never finished
 *   - free plan, no Stripe customer
 *   - no staff and no shifts
 * Removing it deletes every document with its tenantId (all models).
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "config.env") });
const fs = require("fs");
const mongoose = require("mongoose");
const { looksLikeGibberish } = require("../utils/signupGuard");

const modelsDir = path.join(__dirname, "..", "models");
for (const file of fs.readdirSync(modelsDir)) {
  if (file.endsWith(".js")) require(path.join(modelsDir, file));
}
const Tenant = mongoose.model("Tenant");
const User = mongoose.model("User");
const Schedule = mongoose.model("Schedule");

async function main() {
  const doDelete = process.argv.includes("--delete");
  await mongoose.connect(process.env.DB_URL);

  const candidates = await Tenant.find({
    setupCompletedAt: null,
    plan: "free",
    $or: [{ stripeCustomerId: null }, { stripeCustomerId: { $exists: false } }],
  })
    .select("name email createdAt")
    .lean();

  const spam = [];
  for (const t of candidates) {
    const owner = await User.findOne({ tenantId: t._id, loginEnabled: true }).select("name").lean();
    if (!looksLikeGibberish(t.name) && !looksLikeGibberish(owner?.name)) continue;
    const [staff, shifts] = await Promise.all([
      User.countDocuments({ tenantId: t._id, loginEnabled: false }),
      Schedule.countDocuments({ tenantId: t._id }),
    ]);
    if (staff || shifts) continue;
    spam.push({ ...t, ownerName: owner?.name || "" });
  }

  console.log(`${spam.length} bot workspaces found (of ${candidates.length} free workspaces that never finished setup):`);
  for (const t of spam) {
    console.log(`  ${t._id}  ${new Date(t.createdAt).toISOString().slice(0, 16)}  ${t.name} / ${t.ownerName}  <${t.email}>`);
  }

  if (!doDelete) {
    console.log("\nNothing deleted. Run again with --delete to remove them.");
  } else if (spam.length) {
    const ids = spam.map((t) => t._id);
    for (const name of mongoose.modelNames()) {
      const model = mongoose.model(name);
      if (name === "Tenant" || !model.schema.path("tenantId")) continue;
      const r = await model.deleteMany({ tenantId: { $in: ids } });
      if (r.deletedCount) console.log(`  ${name}: ${r.deletedCount} removed`);
    }
    const r = await Tenant.deleteMany({ _id: { $in: ids } });
    console.log(`  Tenant: ${r.deletedCount} removed`);
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
