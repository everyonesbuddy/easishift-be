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
  resetPassword,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
} = require("../controllers/authController");

const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const restrictTo = require("../middleware/roleMiddleware");

// Tenant signup (creates hospital + admin user)
router.post("/signup/tenant", registerTenant);

// Staff signup (admin only)
router.post("/signup/staff", auth, tenant, restrictTo("admin"), registerStaff);
router.post(
  "/signup/staff/bulk",
  auth,
  tenant,
  restrictTo("admin"),
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

// Get all users (optionally filter by role)
router.get("/users", auth, tenant, getAllUsers);

// Get single user by ID
router.get("/:id", auth, tenant, getUserById);

// Update user
router.put("/:id", auth, tenant, updateUser);

// Delete user (admin only)
router.delete("/:id", auth, tenant, restrictTo("admin"), deleteUser);

module.exports = router;
