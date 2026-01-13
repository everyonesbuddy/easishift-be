const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Tenant = require("../models/tenantModel");

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    // Avoid deprecated connection options; let mongoose choose defaults
    await mongoose.connect(process.env.DB_URL);
    console.log("Connected.");

    const results = {};

    // 1) Ensure seatLimit exists and is at least 1
    const seatRes = await Tenant.updateMany(
      {
        $or: [
          { seatLimit: { $exists: false } },
          { seatLimit: null },
          { seatLimit: { $lt: 1 } },
        ],
      },
      { $set: { seatLimit: 1 } }
    );
    results.seatLimit = seatRes.modifiedCount ?? seatRes.nModified ?? 0;

    // 2) Ensure planKey is explicit (null if missing)
    const planRes = await Tenant.updateMany(
      { planKey: { $exists: false } },
      { $set: { planKey: null } }
    );
    results.planKey = planRes.modifiedCount ?? planRes.nModified ?? 0;

    // 3) Ensure subscriptionStatus has a default
    const statusRes = await Tenant.updateMany(
      { subscriptionStatus: { $exists: false } },
      { $set: { subscriptionStatus: "inactive" } }
    );
    results.subscriptionStatus =
      statusRes.modifiedCount ?? statusRes.nModified ?? 0;

    // 4) Ensure billing fields exist (set to null if missing)
    const billingFields = [
      "billingEmail",
      "stripeCustomerId",
      "stripeSubscriptionId",
      "stripePriceId",
    ];

    for (const field of billingFields) {
      const filter = {};
      filter[field] = { $exists: false };
      const update = { $set: {} };
      update.$set[field] = null;
      const r = await Tenant.updateMany(filter, update);
      results[field] = r.modifiedCount ?? r.nModified ?? 0;
    }

    console.log("✔ Migration complete.", results);

    await mongoose.connection.close();
    console.log("Connection closed.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

run();
