// scripts/migrate-add-role-to-schedules.js
const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const Schedule = require("../models/scheduleModel");
const User = require("../models/userModel");

async function run() {
  try {
    console.log("Connecting to MongoDB...");

    await mongoose.connect(process.env.DB_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("Connected.");

    const schedules = await Schedule.find({});

    console.log(`Found ${schedules.length} schedules to update.`);

    let updated = 0;

    for (const sched of schedules) {
      const user = await User.findById(sched.staffId);

      if (!user) {
        console.warn(`⚠ No user found for schedule ${sched._id}`);
        continue;
      }

      sched.role = user.role || "other";
      await sched.save();

      updated++;
    }

    console.log(`✔ Migration complete. Updated ${updated} schedules.`);

    await mongoose.connection.close();
    console.log("Connection closed.");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

run();
