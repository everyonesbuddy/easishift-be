const express = require("express");
const router = express.Router();

const {
  registerTenant,
  loginStaff,
  changePassword,
  forgotPassword,
  sendPasswordReset,
  resetPassword,
  getMe,
} = require("../controllers/authController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

// Workspace signup (creates the workspace + its owner)
router.post("/signup", registerTenant);
router.post("/signup/tenant", registerTenant); // old path, kept for the current app

// Accounts (owner / schedulers / viewers). Staff don't log in — they use
// their personal link. Staff are managed under /api/v1/staff, accounts
// under /api/v1/members.
router.post("/login", loginStaff);
router.post("/login/staff", loginStaff); // old path, kept for the current app
router.get("/me", auth, tenant, getMe);
router.patch("/change-password", auth, changePassword);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword); // also accepts invites
router.post(
  "/users/:id/send-password-reset",
  auth,
  tenant,
  requirePermission("roles.manage"),
  sendPasswordReset,
);

module.exports = router;
