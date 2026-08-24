const mongoose = require("mongoose");
const path = require("path");
const dotenv = require("dotenv");

const User = require("../models/userModel");
const { normalizeRole, getUserRoles } = require("../config/authorization");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

async function run() {
  try {
    if (!process.env.DB_URL) {
      throw new Error("DB_URL is required in config.env");
    }

    const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";
    await mongoose.connect(process.env.DB_URL);

    const users = await User.find({}).select("role roles");
    let modified = 0;

    for (const user of users) {
      const roles = getUserRoles(user).map(normalizeRole);
      if (!roles.length) roles.push("staff");

      const currentRoles = Array.isArray(user.roles)
        ? user.roles.map(normalizeRole).filter(Boolean)
        : [];
      const currentRole = normalizeRole(user.role);
      const unchanged =
        JSON.stringify(currentRoles) === JSON.stringify(roles) &&
        currentRole === roles[0];

      if (unchanged) continue;

      modified += 1;
      if (!dryRun) {
        user.roles = roles;
        user.role = roles[0];
        await user.save({ validateBeforeSave: false });
      }
    }

    console.log(`${dryRun ? "Would update" : "Updated"} ${modified} user(s).`);

    await mongoose.connection.close();
  } catch (err) {
    console.error("User role migration failed:", err);
    process.exitCode = 1;
  }
}

run();
