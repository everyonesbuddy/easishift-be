const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: "./config.env" });
const { assertStaffLinkKey } = require("./utils/staffLinks");

// Staff links can't be created or re-sent without this key; fail fast.
assertStaffLinkKey();

const app = require("./app");

// ✅ Connect to MongoDB
mongoose.set("strictQuery", true);

mongoose
  .connect(process.env.DB_URL)
  .then(() => console.log("✅ Database Connected"))
  .catch((err) => console.error("🚫 Database Connection Error:", err));

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
