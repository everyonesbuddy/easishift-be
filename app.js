const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const cron = require("node-cron");
const { sendPendingReminders } = require("./utils/scheduleJobs");
const FacilityPreferences = require("./models/facilityPreferencesModel");
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
const facilityPreferencesRoutes = require("./routes/facilityPreferencesRoutes");
const timeTrackingRoutes = require("./routes/timeTrackingRoutes");
const stripeRoutes = require("./routes/stripeRoutes");
const marketingRoutes = require("./routes/marketingRoutes");

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
  }),
);

app.use(cookieParser());

// CORS: allow production site and local dev. Use a whitelist plus pattern
// matching for dynamic Expo Go and LAN dev origins. Stripe webhooks and other
// server-to-server calls will have no Origin and are allowed.
const allowedOrigins = new Set([
  "https://easishift.com",
  "https://wisershifts.com",
  "http://localhost:5173",
  "http://localhost:8081",
]);

const localDevOriginPattern =
  /^(https?:\/\/(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?)\/?$/;

const expoOriginPattern = /^(exp|exps):\/\/[^\s/]+(?::\d{2,5})?\/?$/;

function isAllowedOrigin(origin) {
  if (allowedOrigins.has(origin)) return true;
  if (localDevOriginPattern.test(origin)) return true;
  if (expoOriginPattern.test(origin)) return true;
  return false;
}

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow server-to-server (Stripe, etc.)
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS not allowed"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// Note: no explicit app.options('*') call because some path parsers reject '*'.
// The CORS middleware applied above will handle preflight requests.

// ✅ Cron job example: send appointment reminders daily at 8 AM
cron.schedule("0 8 * * *", async () => {
  console.log("⏰ Running daily reminder job...");
  await sendPendingReminders();
});

// ✅ Cron job: every 2 hours close out past schedules
cron.schedule("0 */2 * * *", async () => {
  console.log("⏰ Running schedule status updater (every 2 hours)...");
  try {
    const now = new Date();
    const [scheduledPast, facilityPrefs] = await Promise.all([
      Schedule.find({
        status: "scheduled",
        endTime: { $lt: now },
      })
        .select("tenantId")
        .lean(),
      FacilityPreferences.find({})
        .select("tenantId timeTracking.enabled")
        .lean(),
    ]);

    const timeTrackingEnabledTenantIds = new Set(
      facilityPrefs
        .filter((prefs) => prefs?.timeTracking?.enabled)
        .map((prefs) => String(prefs.tenantId)),
    );

    const noShowScheduleIds = [];
    const completedScheduleIds = [];

    for (const schedule of scheduledPast) {
      if (timeTrackingEnabledTenantIds.has(String(schedule.tenantId))) {
        noShowScheduleIds.push(schedule._id);
      } else {
        completedScheduleIds.push(schedule._id);
      }
    }

    const noShowResult = noShowScheduleIds.length
      ? await Schedule.updateMany(
          { _id: { $in: noShowScheduleIds } },
          { $set: { status: "no_show", "meta.noShowAt": now } },
        )
      : { modifiedCount: 0, nModified: 0 };

    const completedResult = await Schedule.updateMany(
      {
        status: "in_progress",
        endTime: { $lt: now },
      },
      { $set: { status: "completed", "meta.completedAt": now } },
    );

    const noShowCount =
      noShowResult.modifiedCount !== undefined
        ? noShowResult.modifiedCount
        : noShowResult.nModified;
    const completedCount =
      completedResult.modifiedCount !== undefined
        ? completedResult.modifiedCount
        : completedResult.nModified;

    console.log(
      `✅ Updated ${noShowCount} schedule(s) to 'no_show' and ${completedCount} schedule(s) to 'completed'`,
    );
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
app.use("/api/v1/facility-preferences", facilityPreferencesRoutes);
app.use("/api/v1/time-tracking", timeTrackingRoutes);
app.use("/api/v1/stripe", stripeRoutes);
app.use("/api/v1/marketing", marketingRoutes);

// ✅ Global Error Handler
app.use(errorHandler);

// ✅ Fallback route
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

module.exports = app;
