/**
 * Staff link PIN + remembered devices.
 * When a facility requires a PIN, a staff link only works on a device
 * that has entered the PIN (it then sends X-Staff-Device with every call).
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const StaffDevice = require("../models/staffDeviceModel");

const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const isValidPin = (pin) => /^\d{4}$/.test(String(pin || ""));

const hashPin = (pin) => bcrypt.hash(String(pin), 10);

const checkPin = (pin, hash) => (hash ? bcrypt.compare(String(pin), hash) : Promise.resolve(false));

async function createDevice({ tenantId, staffId, userAgent }) {
  const token = crypto.randomBytes(32).toString("base64url");
  await StaffDevice.create({
    tenantId,
    staffId,
    tokenHash: hashToken(token),
    userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
    lastUsedAt: new Date(),
  });
  return token;
}

async function findDevice({ token, staffId, tenantId }) {
  if (!token || String(token).length < 20 || String(token).length > 100) return null;
  return StaffDevice.findOne({
    tokenHash: hashToken(token),
    staffId,
    tenantId,
    revokedAt: null,
  });
}

const revokeDevices = (staff) =>
  StaffDevice.updateMany(
    { staffId: staff._id, tenantId: staff.tenantId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );

module.exports = {
  MAX_FAILURES,
  LOCK_MINUTES,
  hashToken,
  isValidPin,
  hashPin,
  checkPin,
  createDevice,
  findDevice,
  revokeDevices,
};
