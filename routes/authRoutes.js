/**
 * Auth Routes
 * ------------
 * Groups all authentication endpoints:
 *  - Tenant signup
 *  - Staff signup (by admin)
 *  - Logins (staff)
 */

const express = require("express");
const router = express.Router();

const {
  registerTenant,
  registerStaff,
  loginStaff,
  changePassword,
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

// Logins
router.post("/login/staff", loginStaff);

// Change passwords
router.patch("/change-password", auth, changePassword);

// Get all users (optionally filter by role)
router.get("/users", auth, tenant, getAllUsers);

// Get single user by ID
router.get("/:id", auth, tenant, getUserById);

// Update user
router.put("/:id", auth, tenant, updateUser);

// Delete user (admin only)
router.delete("/:id", auth, tenant, restrictTo("admin"), deleteUser);

module.exports = router;
