/**
 * Password setup / reset links for workspace accounts (owner, schedulers,
 * viewers). Staff contacts never get these — they use their staff link.
 */
const crypto = require("crypto");

const DEFAULT_PASSWORD_SETUP_TTL_MINUTES = 60 * 24 * 60;
const DEFAULT_PASSWORD_RESET_TTL_MINUTES = 14 * 24 * 60;

const getPasswordTtlMs = (envName, fallbackMinutes) => {
  const parsed = Number(process.env[envName]);
  const minutes =
    Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : fallbackMinutes;
  return minutes * 60 * 1000;
};

const getPasswordSetupTtlMs = () =>
  getPasswordTtlMs(
    "PASSWORD_SETUP_TTL_MINUTES",
    DEFAULT_PASSWORD_SETUP_TTL_MINUTES,
  );

const getPasswordResetTtlMs = () =>
  getPasswordTtlMs(
    "PASSWORD_RESET_TTL_MINUTES",
    DEFAULT_PASSWORD_RESET_TTL_MINUTES,
  );

const getTtlLabel = (ttlMs) => {
  const ttlMinutes = Math.floor(ttlMs / (60 * 1000));
  if (ttlMinutes % (24 * 60) === 0) {
    const days = ttlMinutes / (24 * 60);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (ttlMinutes % 60 === 0) {
    const hours = ttlMinutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${ttlMinutes} minute${ttlMinutes === 1 ? "" : "s"}`;
};

const getPasswordSetupValidityText = () =>
  `valid for ${getTtlLabel(getPasswordSetupTtlMs())}`;
const getPasswordResetValidityText = () =>
  `valid for ${getTtlLabel(getPasswordResetTtlMs())}`;

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

// Links always point at the single app URL.
const buildResetUrl = (req, token) => {
  const baseUrl = String(
    process.env.FRONTEND_URL || req?.headers?.origin || "",
  ).replace(/\/+$/, "");
  const resetPath = process.env.FRONTEND_RESET_PATH || "/reset-password";
  if (!baseUrl) return token;
  return `${baseUrl}${resetPath}?token=${token}`;
};

/** Issues a token on the user and returns the URL. ttl: "setup" | "reset" */
const issuePasswordLink = async (req, user, ttl = "setup") => {
  const token = crypto.randomBytes(32).toString("hex");
  user.passwordResetToken = hashToken(token);
  user.passwordResetExpires = new Date(
    Date.now() +
      (ttl === "reset" ? getPasswordResetTtlMs() : getPasswordSetupTtlMs()),
  );
  await user.save({ validateBeforeSave: false });
  return buildResetUrl(req, token);
};

const createPasswordSetupLink = (req, user) =>
  issuePasswordLink(req, user, "setup");

module.exports = {
  hashToken,
  buildResetUrl,
  issuePasswordLink,
  createPasswordSetupLink,
  getPasswordSetupValidityText,
  getPasswordResetValidityText,
};
