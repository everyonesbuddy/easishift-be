const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
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
const stripeRoutes = require("./routes/stripeRoutes");

const app = express();

// ✅ Dev logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ✅ Middleware
// JSON parser with Stripe webhook-safe verification.
// Capture raw request body for Stripe webhook endpoints so signature
// verification code can use `req.rawBody`.
app.use(
  express.json({
    limit: "5mb",
    verify: (req, res, buf) => {
      const url = req.originalUrl || req.url || "";
      if (url.startsWith("/api/v1/stripe/webhook")) {
        req.rawBody = buf.toString();
      }
    },
  })
);

app.use(cookieParser());

// CORS: allow production site and local dev. Use a whitelist and echo origin
// back when credentials are required. Stripe webhooks and other server-to-
// server calls will have no Origin and are allowed.
const whitelist = ["https://easishift.com", "http://localhost:5173"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow server-to-server (Stripe, etc.)
      if (whitelist.indexOf(origin) !== -1) {
        return callback(null, true);
      }
      return callback(new Error("CORS not allowed"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Enable preflight for all routes
app.options("*", cors());

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
app.use("/api/v1/stripe", stripeRoutes);

// ✅ Global Error Handler
app.use(errorHandler);

// ✅ Fallback route
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

module.exports = app;
