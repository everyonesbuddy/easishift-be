const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");

// Helper: Create JWT
const signToken = (id, role, tenantId) =>
  jwt.sign({ id, role, tenantId }, process.env.JWT_SECRET, { expiresIn: "7d" });

// Helper: Send cookie + response
const sendTokenResponse = (res, token, data) => {
  res.cookie("jwt", token, { httpOnly: true, secure: false });
  res.status(200).json({ token, ...data });
};

/**
 * TENANT SIGNUP
 * -------------
 * Creates a tenant (hospital/clinic) and its admin user.
 */
exports.registerTenant = async (req, res, next) => {
  try {
    const { name, email, password, phone, address, adminName } = req.body;

    // Create tenant
    const tenant = await Tenant.create({
      name,
      email,
      phone,
      address,
    });

    // Create admin user
    const passwordHash = await bcrypt.hash(password, 12);
    const adminUser = await User.create({
      tenantId: tenant._id,
      name: adminName,
      email,
      passwordHash,
      role: "admin",
    });

    // Generate token
    const token = signToken(adminUser._id, adminUser.role, adminUser.tenantId);

    sendTokenResponse(res, token, {
      message: "Tenant and admin created successfully",
      tenant,
      user: adminUser,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * STAFF SIGNUP (ADMIN ONLY)
 * -------------------------
 * Creates new staff under a tenant.
 */
exports.registerStaff = async (req, res, next) => {
  try {
    const { name, email, password, role } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await User.create({
      tenantId: req.tenantId,
      name,
      email,
      passwordHash,
      role,
    });

    res.status(201).json({ message: "Staff created successfully", user });
  } catch (err) {
    next(err);
  }
};

/**
 * STAFF / ADMIN LOGIN
 * -------------------
 * Route: POST /api/v1/auth/login/staff
 */
exports.loginStaff = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+passwordHash");
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ message: "Invalid credentials" });

    const token = signToken(user._id, user.role, user.tenantId);
    sendTokenResponse(res, token, { user });
  } catch (err) {
    next(err);
  }
};

/**
 * CHANGE PASSWORD
 * ---------------
 * Works for staff + admin
 */
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select("+passwordHash");
    if (!user) return res.status(404).json({ message: "User not found" });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid)
      return res.status(400).json({ message: "Incorrect current password" });

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    next(err);
  }
};

/**
 * GET ALL USERS
 * -------------
 * Admin/staff listing their tenant users
 */
exports.getAllUsers = async (req, res, next) => {
  try {
    const query = { tenantId: req.tenantId };
    if (req.query.role) query.role = req.query.role;

    const users = await User.find(query).select("-passwordHash");
    res.status(200).json(users);
  } catch (err) {
    next(err);
  }
};

/**
 * GET USER BY ID
 */
exports.getUserById = async (req, res, next) => {
  try {
    const user = await User.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    }).select("-passwordHash");

    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(user);
  } catch (err) {
    next(err);
  }
};

/**
 * UPDATE USER
 */
exports.updateUser = async (req, res, next) => {
  try {
    const { name, email, role } = req.body;

    const updated = await User.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { name, email, role },
      { new: true }
    ).select("-passwordHash");

    if (!updated) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ message: "User updated", user: updated });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE USER
 */
exports.deleteUser = async (req, res, next) => {
  try {
    const deleted = await User.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!deleted) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ message: "User deleted successfully" });
  } catch (err) {
    next(err);
  }
};
