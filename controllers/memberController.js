/**
 * Members (workspace accounts)
 * ----------------------------
 * The people who sign in: one owner, schedulers, and viewers (free).
 *
 * Routes: /api/v1/members
 */
const mongoose = require("mongoose");
const User = require("../models/userModel");
const { getUserRoles } = require("../config/authorization");
const { assertLimit } = require("../utils/planLimits");
const { sendEmail } = require("../utils/sendEmail");
const {
  createPasswordSetupLink,
  getPasswordSetupValidityText,
} = require("../utils/passwordLinks");

const INVITABLE_ROLES = ["scheduler", "viewer"];

const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// The single workspace role of an account (legacy "admin" reads as scheduler).
const getMemberRole = (user) => {
  const roles = getUserRoles(user);
  if (roles.includes("owner")) return "owner";
  if (roles.includes("scheduler") || roles.includes("admin")) return "scheduler";
  if (roles.includes("viewer")) return "viewer";
  return null;
};

const toMemberResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: getMemberRole(user),
  status: user.status || "active",
  invitePending: !user.passwordHash,
  createdAt: user.createdAt,
});

const findMember = (req, id = req.params.id) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return User.findOne({
    _id: id,
    tenantId: req.tenantId,
    loginEnabled: true,
  }).select("+passwordHash");
};

const sendInviteEmail = async (req, member) => {
  const setupUrl = await createPasswordSetupLink(req, member);
  const inviter = req.user?.name || "Your team";
  const workspace = req.tenant?.name || "WiserShifts";
  const html = `
    <p>Hi ${member.name || "there"},</p>
    <p>${inviter} invited you to <strong>${workspace}</strong> on WiserShifts as a ${getMemberRole(member)}.</p>
    <p>Set your password to get started (${getPasswordSetupValidityText()}):</p>
    <p><a href="${setupUrl}">${setupUrl}</a></p>
  `;
  return sendEmail(
    member.email,
    `${inviter} invited you to ${workspace}`,
    html,
    null,
    { tenantId: req.tenantId },
  );
};

/**
 * GET /api/v1/members
 */
exports.listMembers = async (req, res, next) => {
  try {
    const members = await User.find({
      tenantId: req.tenantId,
      loginEnabled: true,
    })
      .select("+passwordHash")
      .sort({ createdAt: 1 });
    res.json(members.map(toMemberResponse));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/members/invite
 * Body: { name, email, role: "scheduler" | "viewer" }
 */
exports.inviteMember = async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const role = String(req.body?.role || "scheduler").toLowerCase();

    if (!name || !email)
      return res.status(400).json({ message: "Name and email are required" });
    if (!INVITABLE_ROLES.includes(role))
      return res
        .status(400)
        .json({ message: "role must be scheduler or viewer" });

    const existing = await User.findOne({ email, loginEnabled: true })
      .select("tenantId")
      .lean();
    if (existing) {
      return res.status(409).json({
        message:
          String(existing.tenantId) === String(req.tenantId)
            ? "This person is already a member"
            : "This email already has a WiserShifts account",
        errorCode: "EMAIL_IN_USE",
      });
    }

    // Viewers are free; schedulers count toward the plan.
    if (role === "scheduler") await assertLimit(req, "schedulers");

    const member = await User.create({
      tenantId: req.tenantId,
      name,
      email,
      loginEnabled: true,
      role,
      roles: [role],
      status: "active",
    });

    const emailResult = await sendInviteEmail(req, member);
    res.status(201).json({
      ...toMemberResponse(member),
      inviteSent: Boolean(emailResult && emailResult.success),
    });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        message: "This email already has a WiserShifts account",
        errorCode: "EMAIL_IN_USE",
      });
    }
    next(err);
  }
};

/**
 * POST /api/v1/members/:id/resend-invite
 */
exports.resendInvite = async (req, res, next) => {
  try {
    const member = await findMember(req);
    if (!member) return res.status(404).json({ message: "Member not found" });
    if (member.passwordHash)
      return res
        .status(400)
        .json({ message: "This member has already accepted their invite" });

    const emailResult = await sendInviteEmail(req, member);
    res.json({ inviteSent: Boolean(emailResult && emailResult.success) });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/members/:id
 * Body: { role: "scheduler" | "viewer" }
 */
exports.updateMember = async (req, res, next) => {
  try {
    const role = String(req.body?.role || "").toLowerCase();
    if (!INVITABLE_ROLES.includes(role))
      return res
        .status(400)
        .json({ message: "role must be scheduler or viewer" });

    const member = await findMember(req);
    if (!member) return res.status(404).json({ message: "Member not found" });
    if (getMemberRole(member) === "owner") {
      return res.status(400).json({
        message: "Transfer ownership first to change the owner's role",
        errorCode: "OWNER_ROLE_LOCKED",
      });
    }
    if (getMemberRole(member) === role) return res.json(toMemberResponse(member));

    if (role === "scheduler") await assertLimit(req, "schedulers");

    member.role = role;
    member.roles = [role];
    await member.save({ validateBeforeSave: false });
    res.json(toMemberResponse(member));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/members/:id/make-owner
 * The caller (current owner) becomes a scheduler.
 */
exports.transferOwnership = async (req, res, next) => {
  try {
    const member = await findMember(req);
    if (!member) return res.status(404).json({ message: "Member not found" });
    if (String(member._id) === String(req.user._id))
      return res.status(400).json({ message: "You're already the owner" });
    if (!member.passwordHash)
      return res.status(400).json({
        message: "They need to accept their invite before becoming owner",
        errorCode: "INVITE_PENDING",
      });

    const wasViewer = getMemberRole(member) === "viewer";
    // A viewer becoming owner adds a scheduler seat (the old owner stays one).
    if (wasViewer) await assertLimit(req, "schedulers");

    member.role = "owner";
    member.roles = ["owner"];
    await member.save({ validateBeforeSave: false });

    await User.updateOne(
      { _id: req.user._id, tenantId: req.tenantId },
      { $set: { role: "scheduler", roles: ["scheduler"] } },
    );

    res.json({
      message: `${member.name} is now the owner`,
      owner: toMemberResponse(member),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/members/:id
 */
exports.removeMember = async (req, res, next) => {
  try {
    const member = await findMember(req);
    if (!member) return res.status(404).json({ message: "Member not found" });
    if (getMemberRole(member) === "owner")
      return res.status(400).json({
        message: "The owner can't be removed. Transfer ownership first.",
        errorCode: "OWNER_ROLE_LOCKED",
      });

    await User.deleteOne({ _id: member._id, tenantId: req.tenantId });
    res.json({ message: "Member removed" });
  } catch (err) {
    next(err);
  }
};

// Exposed for unit tests.
exports._getMemberRole = getMemberRole;
