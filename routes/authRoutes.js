/**
 * Auth Routes
 * ------------
 * Groups all authentication endpoints:
 *  - Tenant signup
 *  - Staff signup (by admin)
 *  - Logins (staff)
 */

const express = require("express");
const multer = require("multer");
const router = express.Router();

// Accept CSV uploads in memory only; reject non-CSV MIME types
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(_req, file, cb) {
    const allowed = ["text/csv", "application/vnd.ms-excel", "text/plain"];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only .csv files are accepted"));
    }
  },
}).single("file");

const {
  registerTenant,
  registerStaff,
  bulkRegisterStaff,
  loginStaff,
  changePassword,
  forgotPassword,
  sendPasswordReset,
  resetPassword,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
} = require("../controllers/authController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

// Tenant signup (creates hospital + admin user)
router.post("/signup/tenant", registerTenant);

// Staff signup (admin only)
router.post(
  "/signup/staff",
  auth,
  tenant,
  requirePermission("staff.manage"),
  registerStaff,
);
router.post(
  "/signup/staff/bulk",
  auth,
  tenant,
  requirePermission("staff.manage"),
  csvUpload,
  bulkRegisterStaff,
);

// Logins
router.post("/login/staff", loginStaff);

// Change passwords
router.patch("/change-password", auth, changePassword);

// Forgot/reset password
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post(
  "/users/:id/send-password-reset",
  auth,
  tenant,
  requirePermission("staff.reset_password"),
  sendPasswordReset,
);

// Get all users (optionally filter by role)
router.get(
  "/users",
  auth,
  tenant,
  requirePermission("staff.view"),
  getAllUsers,
);

// Get single user by ID
router.get("/:id", auth, tenant, requirePermission("staff.view"), getUserById);

// Update user
router.put("/:id", auth, tenant, requirePermission("staff.manage"), updateUser);

// Delete user or own account
router.delete(
  "/:id",
  auth,
  tenant,
  requirePermission("staff.manage"),
  deleteUser,
);

module.exports = router;
