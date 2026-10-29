const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const {
  registerTenant,
  loginStaff,
  changePassword,
  forgotPassword,
  sendPasswordReset,
  resetPassword,
  getMe,
  updateMe,
} = require("../controllers/authController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

// Workspace signup (creates the workspace + its owner). Public, so limited
// per visitor; bot checks are in utils/signupGuard.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many signups from here. Try again in an hour." },
});
router.post("/signup", signupLimiter, registerTenant);
router.post("/signup/tenant", signupLimiter, registerTenant); // old path, kept for the current app

// Login and password emails: enough for real people, not for guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many tries. Wait a few minutes and try again." },
});

// Accounts (owner / schedulers / viewers). Staff don't log in — they use
// their personal link. Staff are managed under /api/v1/staff, accounts
// under /api/v1/members.
router.post("/login", loginLimiter, loginStaff);
router.post("/login/staff", loginLimiter, loginStaff); // old path, kept for the current app
router.get("/me", auth, tenant, getMe);
router.patch("/me", auth, updateMe);
router.patch("/change-password", auth, changePassword);
router.post("/forgot-password", loginLimiter, forgotPassword);
router.post("/reset-password", resetPassword); // also accepts invites
router.post(
  "/users/:id/send-password-reset",
  auth,
  tenant,
  requirePermission("roles.manage"),
  sendPasswordReset,
);

module.exports = router;
