/**
 * POST /api/v1/staff-link/request  { contact }
 *
 * "Send me my link" from the mobile app (or anywhere). A staff member types
 * the phone number or email their scheduler has on file; we send their
 * personal link to that same contact. Nothing is revealed in the answer:
 * the reply is the same whether or not we found them, and the link only
 * ever goes to the contact already on file.
 */
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");
const { buildE164Number, digitsOnly } = require("../utils/phone");
const { getStaffLinkUrl } = require("../utils/staffLinks");
const { sendToStaff } = require("../utils/notify");
const { getEffectivePlanKey } = require("../config/plans");

const GENERIC = {
  message:
    "If that phone or email is on a schedule, we've sent the link to it. It can take a minute.",
};

const findStaffByContact = async (contact) => {
  const raw = String(contact || "").trim();
  if (!raw) return [];
  const base = { loginEnabled: false, status: "active" };
  if (raw.includes("@")) {
    return User.find({ ...base, email: raw.toLowerCase() }).limit(10).lean();
  }
  const digits = digitsOnly(raw);
  if (digits.length < 7) return [];
  const candidates = new Set([buildE164Number(null, raw), raw.startsWith("+") ? `+${digits}` : null].filter(Boolean));
  const exact = await User.find({ ...base, phoneE164: { $in: [...candidates] } }).limit(10).lean();
  if (exact.length) return exact;
  // Fall back to the last 10 digits (local formats, other country codes).
  const tail = digits.slice(-10);
  return User.find({ ...base, phoneE164: { $regex: `${tail}$` } }).limit(10).lean();
};

exports.requestLink = async (req, res, next) => {
  try {
    const people = await findStaffByContact(req.body?.contact);
    for (const staff of people) {
      const tenant = await Tenant.findById(staff.tenantId);
      if (!tenant) continue;
      const url = await getStaffLinkUrl(staff);
      const facility = tenant.name;
      await sendToStaff({
        tenant,
        planKey: getEffectivePlanKey(tenant),
        staff,
        kind: "link",
        sms: `${facility}: here's your WiserShifts link for your schedule, swaps and time off: ${url}`,
        emailSubject: `Your ${facility} schedule link`,
        emailHtml: `<p>Hi ${String(staff.name || "").split(" ")[0]},</p><p>Here's your link to see your schedule, swap or pick up shifts, and request time off. Open it on your phone; if you have the WiserShifts app it opens there.</p><p><a href="${url}">${url}</a></p><p>If you didn't ask for this, you can ignore it.</p>`,
      }).catch(() => null);
    }
    res.json(GENERIC);
  } catch (err) {
    next(err);
  }
};

exports._findStaffByContact = findStaffByContact;
