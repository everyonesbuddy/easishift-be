const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const compression = require("compression");
const cron = require("node-cron");
const hqKlaviyo = require("./utils/hq/klaviyo");
const hqSheets = require("./utils/hq/sheetSync");
const errorHandler = require("./middleware/errorMiddleware");
const { sendTrialEmails } = require("./utils/trialJobs");
const { sendShiftReminders } = require("./utils/reminderJobs");
const { closeOutPastShifts } = require("./utils/closeOutShifts");
const { sendWeeklyLaborReports } = require("./utils/laborReportJobs");

// Routers
const tenantRouter = require("./routes/tenantRoutes");
const messageRouter = require("./routes/messageRoutes");
const authRouter = require("./routes/authRoutes");
const summaryRouter = require("./routes/summaryRoutes");
const scheduleRoutes = require("./routes/scheduleRoutes");
const timeOffRoutes = require("./routes/timeOffRoutes");
const coverageRoutes = require("./routes/coverageRoutes");
const laborRoutes = require("./routes/laborRoutes");
const preferencesRoutes = require("./routes/preferencesRoutes");
const facilityPreferencesRoutes = require("./routes/facilityPreferencesRoutes");
const timeTrackingRoutes = require("./routes/timeTrackingRoutes");
const stripeRoutes = require("./routes/stripeRoutes");
const billingRoutes = require("./routes/billingRoutes");
const staffRoutes = require("./routes/staffRoutes");
const memberRoutes = require("./routes/memberRoutes");
const setupRoutes = require("./routes/setupRoutes");
const staffingTemplateRoutes = require("./routes/staffingTemplateRoutes");
const weekRoutes = require("./routes/weekRoutes");
const staffLinkRoutes = require("./routes/staffLinkRoutes");
const staffLinkRequestRoutes = require("./routes/staffLinkRequestRoutes");
const smsRoutes = require("./routes/smsRoutes");
const marketingRoutes = require("./routes/marketingRoutes");
const hqRoutes = require("./routes/hqRoutes");
const nlRoutes = require("./routes/nlRoutes");
const exportRoutes = require("./routes/exportRoutes");
const publicRoutes = require("./routes/publicRoutes");
const swaggerUi = require("swagger-ui-express");
const buildOpenApiSpec = require("./docs/openapiSpec");

const app = express();
// Heroku puts one proxy in front of us: without this every request looks
// like it came from the proxy, and per-visitor rate limits lump everyone
// together.
app.set("trust proxy", 1);
const openApiSpec = buildOpenApiSpec();

// ✅ Dev logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ✅ Middleware
// Gzip responses (Heroku doesn't); big JSON lists shrink several times over.
app.use(compression());

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
// Comma-separated list in ALLOWED_ORIGINS, e.g.
// "https://wisershifts.com,https://www.wisershifts.com"
const allowedOrigins = new Set(
  (
    process.env.ALLOWED_ORIGINS ||
    "https://wisershifts.com,https://easishift.com,http://localhost:5173,http://localhost:8081"
  )
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean),
);

const localDevOriginPattern =
  /^(https?:\/\/((?:[a-z0-9-]+\.)?localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?)\/?$/;

const expoOriginPattern = /^(exp|exps):\/\/[^\s/]+(?::\d{2,5})?\/?$/;

function isAllowedOrigin(origin) {
  if (allowedOrigins.has(String(origin).replace(/\/+$/, ""))) return true;
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
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Staff-Device"],
  }),
);

// Note: no explicit app.options('*') call because some path parsers reject '*'.
// The CORS middleware applied above will handle preflight requests.

// ✅ Cron job: Pro trial reminder / ended emails (daily, 14:00 UTC)
cron.schedule("0 14 * * *", async () => {
  try {
    await sendTrialEmails();
  } catch (err) {
    console.error("🚫 Error sending trial emails:", err);
  }
});

// ✅ Cron job: Monday labor email (hourly at :20; sends at 7 a.m. local on Mondays)
cron.schedule("20 * * * *", async () => {
  try {
    const { sent } = await sendWeeklyLaborReports();
    if (sent) console.log(`📊 Sent ${sent} Monday labor report(s)`);
  } catch (err) {
    console.error("🚫 Error sending labor reports:", err);
  }
});

// ✅ Cron job: shift reminders (hourly, at :05)
cron.schedule("5 * * * *", async () => {
  try {
    const { sent } = await sendShiftReminders();
    if (sent) console.log(`⏰ Sent ${sent} shift reminder(s)`);
  } catch (err) {
    console.error("🚫 Error sending shift reminders:", err);
  }
});

// ✅ Cron job: HQ email signals from Klaviyo (hourly at :40; no-op without KLAVIYO_PRIVATE_KEY)
cron.schedule("40 * * * *", async () => {
  if (!hqKlaviyo.isConfigured()) return;
  try {
    const r = await hqKlaviyo.syncEmailSignals();
    if (!r.ok) console.error("🚫 HQ Klaviyo sync:", r.error);
  } catch (err) {
    console.error("🚫 HQ Klaviyo sync failed:", err);
  }
});

// ✅ Cron job: HQ ← Google Sheets (every 2 hours at :50; no-op until tabs are saved in HQ)
cron.schedule("50 */2 * * *", async () => {
  try {
    const { sources } = await hqSheets.getConfig();
    if (!sources.length) return;
    const r = await hqSheets.syncSheets();
    if (!r.ok) console.error("🚫 HQ sheet sync:", r.error || "some tabs failed");
  } catch (err) {
    console.error("🚫 HQ sheet sync failed:", err);
  }
});

// ✅ Cron job: every 2 hours close out past schedules (no-show / completed)
cron.schedule("0 */2 * * *", async () => {
  console.log("⏰ Running schedule status updater (every 2 hours)...");
  try {
    const { noShow, completed } = await closeOutPastShifts();
    console.log(`✅ Updated ${noShow} schedule(s) to 'no_show' and ${completed} schedule(s) to 'completed'`);
  } catch (err) {
    console.error("🚫 Error updating schedules status:", err);
  }
});

// API docs
app.get("/openapi.json", (req, res) => {
  res.json(openApiSpec);
});
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));

// ✅ API Routes
app.use("/api/v1/tenants", tenantRouter);
app.use("/api/v1/messages", messageRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/summary", summaryRouter);
app.use("/api/v1/schedules", scheduleRoutes);
app.use("/api/v1/timeoff", timeOffRoutes);
app.use("/api/v1/coverage", coverageRoutes);
app.use("/api/v1/labor", laborRoutes);
app.use("/api/v1/preferences", preferencesRoutes);
app.use("/api/v1/facility-preferences", facilityPreferencesRoutes);
app.use("/api/v1/time-tracking", timeTrackingRoutes);
app.use("/api/v1/stripe", stripeRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/staff", staffRoutes);
app.use("/api/v1/members", memberRoutes);
app.use("/api/v1/setup", setupRoutes);
app.use("/api/v1/staffing-template", staffingTemplateRoutes);
app.use("/api/v1/weeks", weekRoutes);
app.use("/api/v1/staff-link", staffLinkRequestRoutes);
app.use("/api/v1/s/:token", staffLinkRoutes);
app.use("/api/v1/sms", smsRoutes);
app.use("/api/v1/marketing", marketingRoutes);
app.use("/api/v1/nl", nlRoutes);
app.use("/api/v1/exports", exportRoutes);
app.use("/api/v1/public", publicRoutes);
app.use("/api/v1/hq", hqRoutes);

// ✅ Global Error Handler
app.use(errorHandler);

// ✅ Fallback route
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

module.exports = app;
