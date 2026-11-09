/**
 * Members (workspace accounts)
 * ----------------------------
 * The people who sign in: one owner, schedulers, and viewers (free).
 *
 * Routes: /api/v1/members
 */
const mongoose = require("mongoose");
const { escapeHtml } = require("../utils/notify");
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");
const { buildE164Number } = require("../utils/phone");
const { requestOptIn, managerConfirmText, logMessage } = require("../utils/notify");
const { sendSMS } = require("../utils/sendSMS");
const { hasFeature } = require("../config/plans");
const { getEffectivePlanKey } = require("../config/plans");
const { getUserRoles } = require("../config/authorization");
const { assertLimit } = require("../utils/planLimits");
const { createStaffContact } = require("./staffController");
const { sendEmail } = require("../utils/sendEmail");
const {
  createPasswordSetupLink,
  getPasswordSetupValidityText,
} = require("../utils/passwordLinks");

const INVITABLE_ROLES = ["administrator", "scheduler", "viewer"];

const normalizeEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// The single workspace role of an account (legacy "admin" reads as scheduler).
const getMemberRole = (user) => {
  const roles = getUserRoles(user);
  if (roles.includes("owner")) return "owner";
  if (roles.includes("administrator")) return "administrator";
  if (roles.includes("scheduler") || roles.includes("admin")) return "scheduler";
  if (roles.includes("viewer")) return "viewer";
  return null;
};

const toMemberResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  userPhone: user.userPhone || "",
  userPhoneCountryCode: user.userPhoneCountryCode || "+1",
  phoneE164: user.phoneE164 || "",
  textStatus: user.phoneE164 ? user.smsConsent?.status || "none" : "no_phone",
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
    <p>Hi ${escapeHtml(member.name || "there")},</p>
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
    // Members who are also on the schedule have a staff contact with their email.
    const staffProfiles = await User.find({
      tenantId: req.tenantId,
      loginEnabled: false,
      status: "active",
      email: { $in: members.map((m) => m.email).filter(Boolean) },
    })
      .select("email")
      .lean();
    const staffIdByEmail = new Map(staffProfiles.map((s) => [s.email, s._id]));
    res.json(
      members.map((m) => ({
        ...toMemberResponse(m),
        staffProfileId: staffIdByEmail.get(m.email) || null,
      })),
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/members/invite
 * Body: { name, email, role: "administrator" | "scheduler" | "viewer" }
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
        .json({ message: "role must be administrator, scheduler or viewer" });

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

    // Viewers are free; admins and schedulers take a scheduler seat.
    if (role !== "viewer") await assertLimit(req, "schedulers");

    const member = await User.create({
      tenantId: req.tenantId,
      name,
      email,
      loginEnabled: true,
      role,
      roles: [role],
      status: "active",
    });

    // A phone on the invite: saved, and they get the opt-in text.
    if (req.body?.userPhone) {
      const phoneErr = await applyPhone(req, member);
      if (phoneErr) {
        await User.deleteOne({ _id: member._id });
        return res.status(400).json({ message: phoneErr });
      }
    }

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
 * Body: { role: "administrator" | "scheduler" | "viewer" }
 */
/** Opted in from inside the app: record how, and send the confirmation text (texting plans). */
const optInInApp = async (req, member) => {
  member.smsConsent = { status: "opted_in", updatedAt: new Date(), method: "in_app" };
  await member.save({ validateBeforeSave: false });
  const tenant = req.tenant || (await Tenant.findById(req.tenantId).lean());
  if (!hasFeature(getEffectivePlanKey(tenant), "sms")) return;
  const result = await sendSMS(member.phoneE164, managerConfirmText(tenant.name || "Your workplace")).catch((e) => ({ success: false, error: e?.message }));
  await logMessage({ tenantId: tenant._id, staffId: member._id, kind: "opt_in_confirm", refId: null, channel: "sms", to: member.phoneE164, status: result?.success ? "sent" : "failed", segments: result?.segments ?? null, error: result?.success ? null : String(result?.error || "") });
};

/**
 * A team member's phone, for call-out alerts and the morning summary by text.
 * A new number starts over on consent and gets the managers' opt-in text
 * (texting plans). Returns an error message, or null.
 */
const applyPhone = async (req, member) => {
  const isSelf = String(req.user?._id) === String(member._id);
  // Someone adding their own number and ticking "Text me alerts" has said yes, in the app.
  const selfConsent = isSelf && req.body?.textConsent === true;
  if (req.body?.userPhone === undefined) {
    if (selfConsent && member.phoneE164 && member.smsConsent?.status !== "opted_in") await optInInApp(req, member);
    return null;
  }
  const raw = String(req.body.userPhone || "").trim();
  const code = String(req.body.userPhoneCountryCode || member.userPhoneCountryCode || "+1").trim();
  const e164 = raw ? buildE164Number(code, raw) : null;
  if (raw && !e164) return "That phone number doesn't look right.";
  const changed = (e164 || null) !== (member.phoneE164 || null);
  member.userPhone = raw ? raw : null;
  member.userPhoneCountryCode = code;
  member.phoneE164 = e164;
  if (changed) member.smsConsent = { status: "none", updatedAt: new Date() };
  await member.save({ validateBeforeSave: false });
  if (e164 && selfConsent && member.smsConsent?.status !== "opted_in") {
    await optInInApp(req, member);
  } else if (changed && e164) {
    const tenant = req.tenant || (await Tenant.findById(req.tenantId).lean());
    await requestOptIn({ tenant, planKey: getEffectivePlanKey(tenant), person: member, manager: true }).catch(() => null);
    member.smsConsent = (await User.findById(member._id).select("smsConsent").lean())?.smsConsent || member.smsConsent;
  }
  return null;
};

/**
 * Name, email and phone together. Email signs them in, so it must be free
 * across WiserShifts; a pending invite goes to the new address. Returns
 * { status, message } on a problem, or null.
 */
const applyContact = async (req, member) => {
  const b = req.body || {};
  let emailChanged = false;
  if (b.name !== undefined) {
    const name = String(b.name || "").trim().slice(0, 100);
    if (!name) return { status: 400, message: "Name can't be empty." };
    member.name = name;
  }
  if (b.email !== undefined) {
    const email = normalizeEmail(b.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 400, message: "That email doesn't look right." };
    if (email !== member.email) {
      const taken = await User.findOne({ email, loginEnabled: true, _id: { $ne: member._id } }).select("tenantId").lean();
      if (taken) return { status: 409, message: String(taken.tenantId) === String(req.tenantId) ? "Someone on your team already uses that email." : "That email already has a WiserShifts account." };
      member.email = email;
      emailChanged = true;
    }
  }
  const phoneErr = await applyPhone(req, member); // saves when the phone is in the request
  if (phoneErr) return { status: 400, message: phoneErr };
  if (req.body?.userPhone === undefined && (b.name !== undefined || emailChanged)) await member.save({ validateBeforeSave: false });
  if (emailChanged && !member.passwordHash) await sendInviteEmail(req, member).catch(() => null);
  return null;
};

/** PATCH /api/v1/members/me { name, email, userPhone, userPhoneCountryCode }: your own details. */
exports.updateMe = async (req, res, next) => {
  try {
    const member = await findMember(req, String(req.user._id));
    if (!member) return res.status(404).json({ message: "Member not found" });
    const err = await applyContact(req, member);
    if (err) return res.status(err.status).json({ message: err.message });
    res.json(toMemberResponse(member));
  } catch (err) {
    next(err);
  }
};

exports.updateMember = async (req, res, next) => {
  try {
    const member = await findMember(req);
    if (!member) return res.status(404).json({ message: "Member not found" });

    const contactErr = await applyContact(req, member);
    if (contactErr) return res.status(contactErr.status).json({ message: contactErr.message });
    // Just their details: done.
    if (req.body?.role === undefined) return res.json(toMemberResponse(member));

    const role = String(req.body?.role || "").toLowerCase();
    if (!INVITABLE_ROLES.includes(role))
      return res
        .status(400)
        .json({ message: "role must be scheduler or viewer" });

    if (getMemberRole(member) === "owner") {
      return res.status(400).json({
        message: "Transfer ownership first to change the owner's role",
        errorCode: "OWNER_ROLE_LOCKED",
      });
    }
    if (getMemberRole(member) === role) return res.json(toMemberResponse(member));

    // Admins and schedulers take a scheduler seat; viewers are free.
    if (role !== "viewer" && getMemberRole(member) === "viewer") await assertLimit(req, "schedulers");

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
/**
 * POST /api/v1/members/:id/staff-profile
 * Body: { role | roles[], userPhone?, userPhoneCountryCode? }
 * "Also put me on the schedule": creates a staff contact for a member (same
 * name and email) so they can be assigned shifts and get a staff link.
 */
exports.addStaffProfile = async (req, res, next) => {
  try {
    const member = await findMember(req);
    if (!member) return res.status(404).json({ message: "Member not found" });
    const body = req.body || {};
    const { status, body: result } = await createStaffContact(req, {
      name: member.name,
      email: member.email,
      role: body.role,
      roles: body.roles,
      userPhone: body.userPhone !== undefined ? body.userPhone : member.userPhone,
      userPhoneCountryCode:
        body.userPhoneCountryCode !== undefined
          ? body.userPhoneCountryCode
          : member.userPhoneCountryCode,
    });
    res.status(status).json(result);
  } catch (err) {
    next(err);
  }
};

exports._getMemberRole = getMemberRole;
exports._test = { applyContact };
