const jwt = require("jsonwebtoken");
const { escapeHtml } = require("../utils/notify");
const { checkSignup } = require("../utils/signupGuard");
const { normalizeViewFilters } = require("../utils/viewFilters");
const bcrypt = require("bcryptjs");
const { DateTime } = require("luxon");
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const { sendEmail } = require("../utils/sendEmail");
const {
  BRANDING_SELECT,
  getPublicBranding,
} = require("../utils/tenantBranding");
const {
  getEffectivePermissions,
  getUserRoles,
  normalizeRole,
} = require("../config/authorization");
const {
  getEffectivePlanKey,
  describePlan,
  trialAvailable,
  TRIAL_PLAN,
  GRACE_DAYS,
  DAY_MS,
  inPostTrialGrace,
} = require("../config/plans");
const { getUsage } = require("../utils/planLimits");
const {
  hashToken,
  issuePasswordLink,
  getPasswordSetupValidityText,
  getPasswordResetValidityText,
} = require("../utils/passwordLinks");

// Helper: Create JWT
const signToken = (id, roles, tenantId) => {
  const normalizedRoles = Array.isArray(roles)
    ? roles.map(normalizeRole).filter(Boolean)
    : [normalizeRole(roles)].filter(Boolean);
  const legacyRole = normalizedRoles[0] || "staff";

  return jwt.sign(
    { id, roles: normalizedRoles, role: legacyRole, tenantId },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
};

const JWT_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Helper: Send cookie + response
const sendTokenResponse = (res, token, data, status = 200) => {
  res.cookie("jwt", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: JWT_COOKIE_MAX_AGE_MS,
  });
  res.status(status).json({ token, ...data });
};

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

const getUserResponse = (user) => {
  const response = user.toObject ? user.toObject() : { ...user };
  response.roles = getUserRoles(user);
  response.permissions = getEffectivePermissions(user);
  return response;
};

const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  if (typeof value === "number") return value === 1;
  return false;
};

/**
 * SIGNUP
 * ------
 * Route: POST /api/v1/auth/signup   (old path: /signup/tenant)
 * Body: { name, email, password, facilityName, timezone, termsAccepted,
 *         termsVersion }
 *
 * Creates the workspace on the Free plan and its owner account. Facility
 * type, roles, shifts and the staffing template come next in onboarding
 * (/api/v1/setup). The old body shape (name = facility, adminName = person,
 * facilityTimezone) is still accepted.
 */
exports.registerTenant = async (req, res, next) => {
  try {
    const body = req.body || {};
    const guard = checkSignup(body);
    if (!guard.ok) {
      console.warn(`Signup blocked (${guard.reason}) from ${req.ip}`);
      return res.status(400).json({ message: guard.message, errorCode: "SIGNUP_BLOCKED" });
    }
    const isLegacyShape = !body.facilityName && body.adminName;
    const personName = String(
      (isLegacyShape ? body.adminName : body.name) || "",
    ).trim();
    const facilityName = String(
      (isLegacyShape ? body.name : body.facilityName) || "",
    ).trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const timezone = String(
      body.timezone || body.facilityTimezone || "",
    ).trim();
    const hasAcceptedTerms = parseBoolean(body.termsAccepted);

    if (!personName || !facilityName || !email || !password) {
      return res.status(400).json({
        message: "Name, facility name, email and password are required",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }
    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters" });
    }
    if (!hasAcceptedTerms) {
      return res.status(400).json({
        message: "Please accept the terms to continue",
        errorCode: "TERMS_REQUIRED",
      });
    }
    if (timezone && !DateTime.local().setZone(timezone).isValid) {
      return res.status(400).json({
        message: `Invalid timezone '${timezone}'`,
        errorCode: "INVALID_TIMEZONE",
      });
    }

    const existing = await User.findOne({ email, loginEnabled: true })
      .select("_id")
      .lean();
    if (existing) {
      return res.status(409).json({
        message: "An account with this email already exists. Log in instead.",
        errorCode: "EMAIL_IN_USE",
      });
    }

    const tenant = await Tenant.create({
      name: facilityName,
      email,
      plan: "free",
      termsAccepted: true,
      termsVersion: body.termsVersion ? String(body.termsVersion).trim() : "1.0",
      termsAcceptedAt: new Date(),
    });

    let owner;
    try {
      owner = await User.create({
        tenantId: tenant._id,
        name: personName,
        email,
        passwordHash: await bcrypt.hash(password, 12),
        loginEnabled: true,
        status: "active",
        role: "owner",
        roles: ["owner"],
      });
      await FacilityPreferences.create({
        tenantId: tenant._id,
        facilityTimezone: timezone || "UTC",
        // The browser's timezone is a real answer, not a guess.
        facilityTimezoneConfirmed: Boolean(timezone),
        unitAreas: [],
      });
    } catch (err) {
      // No transactions without a replica set: undo by hand.
      await Promise.all([
        Tenant.deleteOne({ _id: tenant._id }),
        User.deleteMany({ tenantId: tenant._id }),
        FacilityPreferences.deleteMany({ tenantId: tenant._id }),
      ]);
      if (err && err.code === 11000) {
        return res.status(409).json({
          message: "An account with this email already exists. Log in instead.",
          errorCode: "EMAIL_IN_USE",
        });
      }
      throw err;
    }

    // Welcome email (best-effort)
    try {
      const appUrl = String(process.env.FRONTEND_URL || "").replace(/\/+$/, "");
      await sendEmail(
        owner.email,
        "Welcome to WiserShifts",
        `
          <p>Hi ${escapeHtml(owner.name)},</p>
          <p>Your workspace for <strong>${escapeHtml(tenant.name)}</strong> is ready. Next: tell us what a normal week needs, add your staff, and publish your first schedule.</p>
          ${appUrl ? `<p><a href="${appUrl}">Open WiserShifts</a></p>` : ""}
        `,
        null,
        { tenantId: tenant._id },
      );
    } catch (err) {
      console.error(
        "Error sending welcome email:",
        err && err.message ? err.message : err,
      );
    }

    const token = signToken(owner._id, getUserRoles(owner), owner.tenantId);
    const planKey = getEffectivePlanKey(tenant);
    sendTokenResponse(res, token, {
      message: "Workspace created",
      user: getUserResponse(owner),
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        facilityType: tenant.facilityType,
        setupCompletedAt: tenant.setupCompletedAt,
      },
      plan: describePlan(planKey),
      trialAvailable: trialAvailable(tenant),
    }, 201);
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
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email || !password)
      return res.status(401).json({ message: "Invalid credentials" });

    // Only workspace accounts sign in; staff use their personal link.
    const user = await User.findOne({
      email,
      loginEnabled: true,
      status: { $ne: "archived" },
    }).select("+passwordHash");
    if (!user || !user.passwordHash)
      return res.status(401).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ message: "Invalid credentials" });

    const tenant = await Tenant.findById(user.tenantId)
      .select(BRANDING_SELECT)
      .lean();

    const roles = getUserRoles(user);
    const token = signToken(user._id, roles, user.tenantId);
    user.passwordHash = undefined;
    sendTokenResponse(res, token, {
      user: getUserResponse(user),
      tenantBranding: tenant ? getPublicBranding(tenant) : null,
    });
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
    if (String(newPassword || "").length < 8)
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters" });

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
          <p>Hi ${escapeHtml(user.name || "there")},</p>
          <p>Your password was just changed.</p>
          <p>If you did not make this change, please contact your admin immediately.</p>
        `;

        const result = await sendEmail(user.email, subject, html, null, {
          tenantId: user.tenantId,
        });
        if (result && result.success) {
          console.log(`Password change email sent to ${user.email}`);
        } else {
          console.error(
            `Password change email failed for ${user._id}:`,
            result && result.error ? result.error : "unknown error",
          );
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

    const user = await User.findOne({
      email: normalizeEmail(email),
      loginEnabled: true,
      status: { $ne: "archived" },
    });
    if (!user) {
      return res
        .status(200)
        .json({ message: "If the email exists, a reset link was sent." });
    }

    const resetUrl = await issuePasswordLink(req, user, "reset");
    const subject = "Password reset request";
    const html = `
      <p>Hi ${escapeHtml(user.name || "there")},</p>
      <p>We received a request to reset your password.</p>
      <p>Use the link below to reset it (${getPasswordResetValidityText()}):</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `;

    const result = await sendEmail(user.email, subject, html, null, {
      tenantId: user.tenantId,
    });
    if (!result || !result.success) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ message: "Email send failed" });
    }

    res
      .status(200)
      .json({ message: "If the email exists, a reset link was sent." });
  } catch (err) {
    next(err);
  }
};

/**
 * SEND PASSWORD RESET (ADMIN ONLY)
 * --------------------------------
 * Issues a fresh reset token for a user in the admin's tenant.
 */
exports.sendPasswordReset = async (req, res, next) => {
  try {
    const user = await User.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
      loginEnabled: true,
    });

    if (!user) return res.status(404).json({ message: "Account not found" });
    if (!user.email) {
      return res.status(400).json({
        message: "User does not have an email address",
      });
    }

    const setupUrl = await issuePasswordLink(req, user, "setup");
    const subject = "Password reset link";
    const html = `
      <p>Hi ${escapeHtml(user.name || "there")},</p>
      <p>Your administrator requested a new password reset link for your account.</p>
      <p>Use the link below to set a new password (${getPasswordSetupValidityText()}):</p>
      <p><a href="${setupUrl}">${setupUrl}</a></p>
      <p>If you did not expect this email, please contact your administrator.</p>
    `;

    const result = await sendEmail(user.email, subject, html, null, {
      tenantId: req.tenantId,
    });
    if (!result || !result.success) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ message: "Email send failed" });
    }

    res.status(200).json({ message: "Password reset link sent" });
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

    if (String(newPassword).length < 8)
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters" });

    const user = await User.findOne({
      passwordResetToken: hashToken(String(token)),
      loginEnabled: true,
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
          <p>Hi ${escapeHtml(user.name || "there")},</p>
          <p>Your password has been reset successfully.</p>
          <p>If you did not make this change, please contact your admin immediately.</p>
        `;

        const result = await sendEmail(user.email, subject, html, null, {
          tenantId: user.tenantId,
        });
        if (result && result.success) {
          console.log(`Password reset email sent to ${user.email}`);
        } else {
          console.error(
            `Password reset email failed for ${user._id}:`,
            result && result.error ? result.error : "unknown error",
          );
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
 * CURRENT SESSION
 * ---------------
 * Route: GET /api/v1/auth/me
 * Everything the app needs on boot: who you are, your workspace, the plan you
 * actually have right now, its limits, and how much of them you're using.
 */
exports.getMe = async (req, res, next) => {
  try {
    const tenant = req.tenant;
    const usage = await getUsage(req);
    res.status(200).json({
      user: getUserResponse(req.user),
      tenant: {
        _id: tenant._id,
        name: tenant.name,
        facilityType: tenant.facilityType,
        setupCompletedAt: tenant.setupCompletedAt,
      },
      plan: describePlan(getEffectivePlanKey(tenant)),
      paidPlan: tenant.plan,
      subscriptionStatus: tenant.subscriptionStatus,
      trialAvailable: trialAvailable(tenant),
      trialPlan: TRIAL_PLAN,
      trialEndsAt: tenant.trialEndsAt,
      usage,
      // Non-owner schedulers can only look while over the scheduler limit.
      readOnlyReason: req.readOnlyReason || null,
      // One week can still be published right after a trial ends over limits.
      grace: inPostTrialGrace(tenant)
        ? {
            endsAt: new Date(new Date(tenant.trialEndsAt).getTime() + GRACE_DAYS * DAY_MS),
            weekStart: tenant.graceWeekStart || null,
            available: usage.overLimit,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * UPDATE MY PROFILE
 * -----------------
 * Route: PATCH /api/v1/auth/me
 * Body: { name?, userPhone?, userPhoneCountryCode?, profilePicture? }
 * (Email and role changes go through the owner under /members.)
 */
const PROFILE_PICTURE_MAX_CHARS = 3 * 1024 * 1024; // ~2 MB image as base64

exports.updateMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { name, userPhone, userPhoneCountryCode, profilePicture, viewFilters } =
      req.body || {};
    if (name !== undefined) {
      const trimmed = String(name || "").trim();
      if (!trimmed) return res.status(400).json({ message: "Name is required" });
      user.name = trimmed.slice(0, 120);
    }
    if (userPhone !== undefined) user.userPhone = userPhone || null;
    if (userPhoneCountryCode !== undefined)
      user.userPhoneCountryCode = userPhoneCountryCode || null;
    if (profilePicture !== undefined) {
      if (
        profilePicture &&
        (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(profilePicture) ||
          profilePicture.length > PROFILE_PICTURE_MAX_CHARS)
      ) {
        return res
          .status(400)
          .json({ message: "Profile picture must be an image under 2 MB" });
      }
      user.profilePicture = profilePicture || null;
    }

    if (viewFilters !== undefined) {
      let cleaned;
      try {
        cleaned = normalizeViewFilters(viewFilters);
      } catch (err) {
        return res.status(400).json({ message: err.message });
      }
      // Only the kinds sent change, so the website and the app don't
      // overwrite each other's other filter.
      for (const [kind, value] of Object.entries(cleaned)) {
        user.set(`viewFilters.${kind}`, value);
      }
    }

    await user.save();
    res.status(200).json({ user: getUserResponse(user) });
  } catch (err) {
    next(err);
  }
};
