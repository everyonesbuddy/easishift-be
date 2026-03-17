const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { parse } = require("csv-parse/sync");
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");
const { sendEmail } = require("../utils/sendEmail");
const { sendSMS } = require("../utils/sendSMS");

// Helper: Create JWT
const signToken = (id, role, tenantId) =>
  jwt.sign({ id, role, tenantId }, process.env.JWT_SECRET, { expiresIn: "7d" });

// Helper: Send cookie + response
const sendTokenResponse = (res, token, data) => {
  res.cookie("jwt", token, { httpOnly: true, secure: false });
  res.status(200).json({ token, ...data });
};

const buildResetUrl = (req, token) => {
  const baseUrl =
    process.env.FRONTEND_BASE_URL ||
    process.env.FRONTEND_URL ||
    req.headers.origin ||
    "";
  const resetPath = process.env.FRONTEND_RESET_PATH || "/reset-password";

  if (!baseUrl) return token;
  const normalizedBase = baseUrl.replace(/\/$/, "");
  return `${normalizedBase}${resetPath}?token=${token}`;
};

const buildE164Number = (countryCode, phone) => {
  if (!phone) return null;

  const rawPhone = String(phone).trim();
  if (!rawPhone) return null;
  if (rawPhone.startsWith("+")) return rawPhone;

  if (!countryCode) return null;
  const normalizedCountryCode = String(countryCode).trim();
  if (!normalizedCountryCode) return null;

  const prefix = normalizedCountryCode.startsWith("+")
    ? normalizedCountryCode
    : `+${normalizedCountryCode}`;

  return `${prefix}${rawPhone}`;
};

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

const resolveRole = (role) =>
  String(role || "staff")
    .trim()
    .toLowerCase();

const getBulkRows = (body) => {
  if (typeof body.csv === "string" && body.csv.trim()) {
    const records = parse(body.csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    return records.map((row, index) => ({
      rowNumber: index + 2,
      ...row,
    }));
  }

  return [];
};

const createPasswordSetupLink = async (req, user) => {
  const setupToken = crypto.randomBytes(32).toString("hex");
  const setupTokenHash = crypto
    .createHash("sha256")
    .update(setupToken)
    .digest("hex");

  user.passwordResetToken = setupTokenHash;
  user.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  return buildResetUrl(req, setupToken);
};

/**
 * TENANT SIGNUP
 * -------------
 * Creates a tenant (hospital/clinic) and its admin user.
 */
exports.registerTenant = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      tenantPhone,
      tenantPhoneCountryCode,
      userPhone,
      userPhoneCountryCode,
      address,
      adminName,
    } = req.body;

    // Create tenant
    const tenant = await Tenant.create({
      name,
      email,
      tenantPhone,
      tenantPhoneCountryCode,
      address,
    });

    // Create admin user
    const passwordHash = await bcrypt.hash(password, 12);
    const adminUser = await User.create({
      tenantId: tenant._id,
      name: adminName,
      email,
      userPhone,
      userPhoneCountryCode,
      passwordHash,
      role: "admin",
    });

    // Notify the admin about account creation (best-effort)
    try {
      if (adminUser.email) {
        const subject = "Your admin account is ready";
        const html = `
          <p>Hi ${adminUser.name || "there"},</p>
          <p>Your admin account for <strong>${tenant.name}</strong> has been created.</p>
          <ul>
            <li><strong>Login email:</strong> ${adminUser.email}</li>
            <li><strong>Tenant:</strong> ${tenant.name}</li>
          </ul>
          <p>You can now sign in and start setting up your team.</p>
        `;

        const result = await sendEmail(adminUser.email, subject, html);
        if (result && result.success) {
          console.log(
            `Admin welcome email sent for tenant ${tenant._id} to ${adminUser.email}`,
          );
        } else {
          console.error(
            `Admin welcome email failed for tenant ${tenant._id}:`,
            result && result.error ? result.error : "unknown error",
          );
        }

        const to = buildE164Number(
          adminUser.userPhoneCountryCode,
          adminUser.userPhone,
        );
        if (to) {
          const smsBody = `Your admin account for ${tenant.name} is ready. You can now sign in and set up your team.`;
          const smsResult = await sendSMS(to, smsBody);
          if (smsResult && smsResult.success) {
            console.log(`Admin welcome SMS sent to ${to}`);
          } else {
            console.error(
              `Admin welcome SMS failed for user ${adminUser._id}:`,
              smsResult && smsResult.error ? smsResult.error : "unknown error",
            );
          }
        }
      }
    } catch (err) {
      console.error(
        "Error sending admin welcome email:",
        err && err.message ? err.message : err,
      );
    }

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
    const { name, email, role, userPhone, userPhoneCountryCode } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }

    const generatedPassword = crypto.randomBytes(24).toString("hex");
    const passwordHash = await bcrypt.hash(generatedPassword, 12);

    const user = await User.create({
      tenantId: req.tenantId,
      name,
      email,
      userPhone,
      userPhoneCountryCode,
      passwordHash,
      role,
    });

    const setupUrl = await createPasswordSetupLink(req, user);

    // Notify the staff member about account creation (best-effort)
    try {
      const tenant = await Tenant.findById(req.tenantId).select("name");
      const tenantName = tenant && tenant.name ? tenant.name : "your tenant";
      if (user.email) {
        const subject = "Your staff account is ready";
        const html = `
          <p>Hi ${user.name || "there"},</p>
          <p>An account has been added for you in ${tenantName}.</p>
          <ul>
            <li><strong>Login email:</strong> ${user.email}</li>
            <li><strong>Role:</strong> ${user.role}</li>
          </ul>
          <p>Set your password using the secure link below (valid for 30 minutes):</p>
          <p><a href="${setupUrl}">${setupUrl}</a></p>
        `;

        const result = await sendEmail(user.email, subject, html);
        if (result && result.success) {
          console.log(`Staff welcome email sent to ${user.email}`);
        } else {
          console.error(
            `Staff welcome email failed for ${user._id}:`,
            result && result.error ? result.error : "unknown error",
          );
        }

        const to = buildE164Number(user.userPhoneCountryCode, user.userPhone);
        if (to) {
          const smsBody = `Your staff account is ready at ${tenantName}. Check your email to set your password.`;
          const smsResult = await sendSMS(to, smsBody);
          if (smsResult && smsResult.success) {
            console.log(`Staff welcome SMS sent to ${to}`);
          } else {
            console.error(
              `Staff welcome SMS failed for ${user._id}:`,
              smsResult && smsResult.error ? smsResult.error : "unknown error",
            );
          }
        }
      }
    } catch (err) {
      console.error(
        "Error sending staff welcome email:",
        err && err.message ? err.message : err,
      );
    }

    res.status(201).json({ message: "Staff created successfully", user });
  } catch (err) {
    next(err);
  }
};

/**
 * BULK STAFF SIGNUP (ADMIN ONLY)
 * ------------------------------
 * Supports:
 *  - req.body.csv: CSV string with headers
 */
exports.bulkRegisterStaff = async (req, res, next) => {
  try {
    const rows = getBulkRows(req.body);
    const allowedRoles = User.schema.path("role").enumValues || [];
    const maxRows = 500;

    if (!rows.length) {
      return res.status(400).json({
        message: "Provide csv payload for bulk registration.",
      });
    }

    if (rows.length > maxRows) {
      return res
        .status(400)
        .json({ message: `Maximum ${maxRows} rows allowed per bulk request.` });
    }

    const duplicateInFile = new Set();
    const normalizedEmails = rows
      .map((row) => normalizeEmail(row.email))
      .filter(Boolean);

    const existingUsers = normalizedEmails.length
      ? await User.find({ email: { $in: normalizedEmails } }).select("email")
      : [];
    const existingEmailSet = new Set(
      existingUsers.map((item) => normalizeEmail(item.email)),
    );

    const result = {
      total: rows.length,
      created: 0,
      skipped: 0,
      failed: 0,
      rows: [],
    };

    for (const row of rows) {
      const name = String(row.name || "").trim();
      const email = normalizeEmail(row.email);
      const role = resolveRole(row.role);
      const userPhone = row.userPhone ? String(row.userPhone).trim() : null;
      const userPhoneCountryCode = row.userPhoneCountryCode
        ? String(row.userPhoneCountryCode).trim()
        : null;

      if (!name || !email) {
        result.failed += 1;
        result.rows.push({
          rowNumber: row.rowNumber,
          email: row.email || null,
          status: "failed_validation",
          reason: "name and email are required",
        });
        continue;
      }

      if (!allowedRoles.includes(role)) {
        result.failed += 1;
        result.rows.push({
          rowNumber: row.rowNumber,
          email,
          status: "failed_validation",
          reason: `invalid role '${row.role || ""}'`,
        });
        continue;
      }

      if (duplicateInFile.has(email)) {
        result.skipped += 1;
        result.rows.push({
          rowNumber: row.rowNumber,
          email,
          status: "skipped_duplicate",
          reason: "duplicate email in import file",
        });
        continue;
      }

      if (existingEmailSet.has(email)) {
        result.skipped += 1;
        result.rows.push({
          rowNumber: row.rowNumber,
          email,
          status: "skipped_duplicate",
          reason: "email already exists",
        });
        duplicateInFile.add(email);
        continue;
      }

      try {
        const generatedPassword = crypto.randomBytes(24).toString("hex");
        const passwordHash = await bcrypt.hash(generatedPassword, 12);
        const user = await User.create({
          tenantId: req.tenantId,
          name,
          email,
          userPhone,
          userPhoneCountryCode,
          passwordHash,
          role,
        });

        const setupUrl = await createPasswordSetupLink(req, user);

        let inviteWarning = null;
        if (user.email) {
          const subject = "Your staff account is ready";
          const html = `
            <p>Hi ${user.name || "there"},</p>
            <p>Your account has been added.</p>
            <ul>
              <li><strong>Login email:</strong> ${user.email}</li>
              <li><strong>Role:</strong> ${user.role}</li>
            </ul>
            <p>Set your password using the secure link below (valid for 30 minutes):</p>
            <p><a href="${setupUrl}">${setupUrl}</a></p>
          `;

          const emailResult = await sendEmail(user.email, subject, html);
          if (!emailResult || !emailResult.success) {
            inviteWarning = "account created but setup email failed";
          }
        }

        result.created += 1;
        result.rows.push({
          rowNumber: row.rowNumber,
          email,
          status: "created",
          userId: user._id,
          warning: inviteWarning,
        });
        duplicateInFile.add(email);
        existingEmailSet.add(email);
      } catch (err) {
        if (err && err.code === 11000) {
          result.skipped += 1;
          result.rows.push({
            rowNumber: row.rowNumber,
            email,
            status: "skipped_duplicate",
            reason: "email already exists",
          });
          duplicateInFile.add(email);
          existingEmailSet.add(email);
          continue;
        }

        result.failed += 1;
        result.rows.push({
          rowNumber: row.rowNumber,
          email,
          status: "failed",
          reason: err && err.message ? err.message : "unknown error",
        });
      }
    }

    return res.status(200).json({
      message: "Bulk staff import completed",
      ...result,
    });
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
 * Works for authenticated staff + admin
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

    // Notify the user about password change (best-effort)
    try {
      if (user.email) {
        const subject = "Your password was changed";
        const html = `
          <p>Hi ${user.name || "there"},</p>
          <p>Your password was just changed.</p>
          <p>If you did not make this change, please contact your admin immediately.</p>
        `;

        const result = await sendEmail(user.email, subject, html);
        if (result && result.success) {
          console.log(`Password change email sent to ${user.email}`);
        } else {
          console.error(
            `Password change email failed for ${user._id}:`,
            result && result.error ? result.error : "unknown error",
          );
        }

        const to = buildE164Number(user.userPhoneCountryCode, user.userPhone);
        if (to) {
          const smsBody =
            "Your password was changed. If this was not you, contact your admin immediately.";
          const smsResult = await sendSMS(to, smsBody);
          if (smsResult && smsResult.success) {
            console.log(`Password change SMS sent to ${to}`);
          } else {
            console.error(
              `Password change SMS failed for ${user._id}:`,
              smsResult && smsResult.error ? smsResult.error : "unknown error",
            );
          }
        }
      }
    } catch (err) {
      console.error(
        "Error sending password change email:",
        err && err.message ? err.message : err,
      );
    }

    res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    next(err);
  }
};

/**
 * FORGOT PASSWORD
 * ---------------
 * Sends reset token to user email.
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(200)
        .json({ message: "If the email exists, a reset link was sent." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.passwordResetToken = resetTokenHash;
    user.passwordResetExpires = new Date(Date.now() + 30 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    const resetUrl = buildResetUrl(req, resetToken);
    const subject = "Password reset request";
    const html = `
      <p>Hi ${user.name || "there"},</p>
      <p>We received a request to reset your password.</p>
      <p>Use the link below to reset it (valid for 30 minutes):</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    const result = await sendEmail(user.email, subject, html);
    if (!result || !result.success) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ message: "Email send failed" });
    }

    const to = buildE164Number(user.userPhoneCountryCode, user.userPhone);
    if (to) {
      const smsBody =
        "A password reset was requested for your account. Check your email for the reset link.";
      const smsResult = await sendSMS(to, smsBody);
      if (smsResult && smsResult.success) {
        console.log(`Password reset request SMS sent to ${to}`);
      } else {
        console.error(
          `Password reset request SMS failed for ${user._id}:`,
          smsResult && smsResult.error ? smsResult.error : "unknown error",
        );
      }
    }

    res
      .status(200)
      .json({ message: "If the email exists, a reset link was sent." });
  } catch (err) {
    next(err);
  }
};

/**
 * RESET PASSWORD
 * --------------
 * Resets password using reset token.
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)
      return res
        .status(400)
        .json({ message: "Token and newPassword are required" });

    const resetTokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      passwordResetToken: resetTokenHash,
      passwordResetExpires: { $gt: new Date() },
    }).select("+passwordResetToken +passwordResetExpires");

    if (!user)
      return res.status(400).json({ message: "Invalid or expired token" });

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    // Notify the user about password reset (best-effort)
    try {
      if (user.email) {
        const subject = "Your password was reset";
        const html = `
          <p>Hi ${user.name || "there"},</p>
          <p>Your password has been reset successfully.</p>
          <p>If you did not make this change, please contact your admin immediately.</p>
        `;

        const result = await sendEmail(user.email, subject, html);
        if (result && result.success) {
          console.log(`Password reset email sent to ${user.email}`);
        } else {
          console.error(
            `Password reset email failed for ${user._id}:`,
            result && result.error ? result.error : "unknown error",
          );
        }

        const to = buildE164Number(user.userPhoneCountryCode, user.userPhone);
        if (to) {
          const smsBody =
            "Your password has been reset successfully. If this was not you, contact your admin.";
          const smsResult = await sendSMS(to, smsBody);
          if (smsResult && smsResult.success) {
            console.log(`Password reset SMS sent to ${to}`);
          } else {
            console.error(
              `Password reset SMS failed for ${user._id}:`,
              smsResult && smsResult.error ? smsResult.error : "unknown error",
            );
          }
        }
      }
    } catch (err) {
      console.error(
        "Error sending password reset email:",
        err && err.message ? err.message : err,
      );
    }

    res.status(200).json({ message: "Password reset successful" });
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
    const { name, email, role, userPhone, userPhoneCountryCode } = req.body;

    const updated = await User.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { name, email, role, userPhone, userPhoneCountryCode },
      { new: true },
    ).select("-passwordHash");

    if (!updated) return res.status(404).json({ message: "User not found" });

    // Notify the user about profile updates (best-effort)
    try {
      if (updated.email) {
        const subject = "Your account details were updated";
        const html = `
          <p>Hi ${updated.name || "there"},</p>
          <p>Your account details were updated by ${
            req.user && req.user.name ? req.user.name : "an administrator"
          }.</p>
          <ul>
            <li><strong>Current email:</strong> ${updated.email}</li>
            <li><strong>Current role:</strong> ${updated.role}</li>
          </ul>
          <p>If you did not expect this change, please contact your admin.</p>
        `;

        const result = await sendEmail(updated.email, subject, html);
        if (result && result.success) {
          console.log(`User update email sent to ${updated.email}`);
        } else {
          console.error(
            `User update email failed for ${updated._id}:`,
            result && result.error ? result.error : "unknown error",
          );
        }

        const to = buildE164Number(
          updated.userPhoneCountryCode,
          updated.userPhone,
        );
        if (to) {
          const smsBody = `Your account details were updated. Current role: ${updated.role}.`;
          const smsResult = await sendSMS(to, smsBody);
          if (smsResult && smsResult.success) {
            console.log(`User update SMS sent to ${to}`);
          } else {
            console.error(
              `User update SMS failed for ${updated._id}:`,
              smsResult && smsResult.error ? smsResult.error : "unknown error",
            );
          }
        }
      }
    } catch (err) {
      console.error(
        "Error sending user update email:",
        err && err.message ? err.message : err,
      );
    }

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
