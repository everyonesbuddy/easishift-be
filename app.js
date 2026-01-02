const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const morgan = require("morgan");
const cron = require("node-cron");
const { sendPendingReminders } = require("./utils/scheduleJobs");
const Schedule = require("./models/scheduleModel");
const errorHandler = require("./middleware/errorMiddleware");

// Routers
const tenantRouter = require("./routes/tenantRoutes");
const messageRouter = require("./routes/messageRoutes");
const authRouter = require("./routes/authRoutes");
const summaryRouter = require("./routes/summaryRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const timeOffRoutes = require("./routes/timeOffRoutes");
const coverageRoutes = require("./routes/coverageRoutes");
const preferencesRoutes = require("./routes/preferencesRoutes");

const app = express();

// ✅ Dev logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ✅ Middleware
app.use(express.json({ limit: "5mb" }));
app.use(cookieParser());
app.use(
  cors({
    origin: "http://localhost:5173", // You can later restrict this to your frontend domain
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true,
  })
);

// ✅ Cron job example: send appointment reminders daily at 8 AM
cron.schedule("0 8 * * *", async () => {
  console.log("⏰ Running daily reminder job...");
  await sendPendingReminders();
});

// ✅ Cron job: every 2 hours mark past schedules as completed
cron.schedule("0 */2 * * *", async () => {
  console.log("⏰ Running schedule status updater (every 2 hours)...");
  try {
    const now = new Date();
    const filter = { status: "scheduled", endTime: { $lt: now } };
    const update = { $set: { status: "completed", "meta.completedAt": now } };
    const result = await Schedule.updateMany(filter, update);
    const count =
      result.modifiedCount !== undefined
        ? result.modifiedCount
        : result.nModified;
    console.log(`✅ Updated ${count} schedule(s) to 'completed'`);
  } catch (err) {
    console.error("🚫 Error updating schedules status:", err);
  }
});

// ✅ API Routes
app.use("/api/v1/tenants", tenantRouter);
app.use("/api/v1/messages", messageRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/summary", summaryRouter);
app.use("/api/v1/schedules", scheduleRoutes);
app.use("/api/v1/timeoff", timeOffRoutes);
app.use("/api/v1/coverage", coverageRoutes);
app.use("/api/v1/preferences", preferencesRoutes);

// ✅ Global Error Handler
app.use(errorHandler);

// ✅ Fallback route
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

module.exports = app;
