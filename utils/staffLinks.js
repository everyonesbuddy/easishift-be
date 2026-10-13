/**
 * Staff links
 * -----------
 * Each staff contact has one live link: `${FRONTEND_URL}/s/<token>`.
 * Token = 32 random bytes (base64url). We store sha256(token) for lookup and
 * an AES-256-GCM copy (STAFF_LINK_KEY) so the same link can be re-sent.
 */
const crypto = require("crypto");
const StaffLink = require("../models/staffLinkModel");

const getKey = () => {
  const hex = String(process.env.STAFF_LINK_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "STAFF_LINK_KEY must be set to 64 hex characters (32 bytes). Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
};

const assertStaffLinkKey = () => {
  getKey();
};

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

const encrypt = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString("base64")).join(":");
};

const decrypt = (value) => {
  const [iv, tag, data] = String(value)
    .split(":")
    .map((part) => Buffer.from(part, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
};

const appUrl = () =>
  String(process.env.FRONTEND_URL || "").replace(/\/+$/, "");

const urlForToken = (token) => `${appUrl()}/s/${token}`;

/** Creates a new live link for a staff member; returns the URL. */
async function createStaffLink(staff) {
  const token = crypto.randomBytes(32).toString("base64url");
  await StaffLink.create({
    tenantId: staff.tenantId,
    staffId: staff._id,
    tokenHash: hashToken(token),
    tokenEnc: encrypt(token),
  });
  return urlForToken(token);
}

/** The live link URL for a staff member, creating one if needed. */
async function getStaffLinkUrl(staff) {
  const link = await StaffLink.findOne({
    staffId: staff._id,
    tenantId: staff.tenantId,
    revokedAt: null,
  })
    .sort({ createdAt: -1 })
    .lean();
  if (!link) return createStaffLink(staff);
  return urlForToken(decrypt(link.tokenEnc));
}

/** Revokes every live link for a staff member. */
const revokeStaffLinks = (staff) =>
  StaffLink.updateMany(
    { staffId: staff._id, tenantId: staff.tenantId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

/** Revokes the old link and returns a new URL. */
async function rotateStaffLink(staff) {
  await revokeStaffLinks(staff);
  return createStaffLink(staff);
}

/** Finds the live link for a raw token (or null). */
const findLiveLink = (token) =>
  StaffLink.findOne({ tokenHash: hashToken(token), revokedAt: null });

module.exports = {
  assertStaffLinkKey,
  hashToken,
  encrypt,
  decrypt,
  createStaffLink,
  getStaffLinkUrl,
  revokeStaffLinks,
  rotateStaffLink,
  findLiveLink,
  urlForToken,
};
