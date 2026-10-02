const Tenant = require("../models/tenantModel");
const { getTenantAppUrl } = require("./tenantDomainUtils");

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DISPLAY_NAME_MAX_LENGTH = 80;
const DEFAULT_PRIMARY_COLOR = "#2563eb";
const BRANDING_SELECT = "name subdomain branding";
const EMAIL_BRANDING_CACHE_TTL_MS = 5 * 60 * 1000;

const emailBrandingCache = new Map();

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

const getLogoPath = (tenant) => {
  const updatedAt = tenant?.branding?.logoUpdatedAt;
  if (!updatedAt) return null;
  return `/api/v1/public/tenants/${tenant._id}/logo?v=${new Date(updatedAt).getTime()}`;
};

const getAbsoluteLogoUrl = (tenant) => {
  const path = getLogoPath(tenant);
  const apiBase = String(process.env.API_PUBLIC_URL || "").replace(/\/+$/, "");
  return path && apiBase ? `${apiBase}${path}` : null;
};

// Safe-to-expose branding (used by the unauthenticated login page).
const getPublicBranding = (tenant) => {
  const branding = tenant?.branding || {};

  return {
    tenantId: String(tenant._id),
    name: tenant.name,
    displayName: branding.displayName || tenant.name,
    subdomain: tenant.subdomain || null,
    appUrl: getTenantAppUrl(tenant),
    logoUrl: getAbsoluteLogoUrl(tenant) || getLogoPath(tenant),
    primaryColor: branding.primaryColor || null,
    secondaryColor: branding.secondaryColor || null,
  };
};

const toNullableTrimmed = (value) =>
  value === null ? null : String(value).trim() || null;

// Converts request input into Mongo $set paths; only keys present in input are touched.
const parseBrandingUpdate = (input = {}) => {
  const set = {};
  const errors = [];

  if (input.displayName !== undefined) {
    const value = toNullableTrimmed(input.displayName);
    if (value && value.length > DISPLAY_NAME_MAX_LENGTH) {
      errors.push(
        `displayName must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer`,
      );
    } else {
      set["branding.displayName"] = value;
    }
  }

  for (const key of ["primaryColor", "secondaryColor"]) {
    if (input[key] === undefined) continue;
    const value = toNullableTrimmed(input[key]);
    if (value && !HEX_COLOR_PATTERN.test(value)) {
      errors.push(`${key} must be a hex color like #1a2b3c`);
    } else {
      set[`branding.${key}`] = value ? value.toLowerCase() : null;
    }
  }

  return { set, errors };
};

const getEmailBranding = async (tenantId) => {
  if (!tenantId) return null;
  const key = String(tenantId);
  const cached = emailBrandingCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const tenant = await Tenant.findById(tenantId).select(BRANDING_SELECT).lean();
  const value = tenant
    ? {
        displayName: tenant.branding?.displayName || tenant.name,
        primaryColor: tenant.branding?.primaryColor || null,
        logoUrl: getAbsoluteLogoUrl(tenant),
        appUrl: getTenantAppUrl(tenant),
      }
    : null;

  emailBrandingCache.set(key, {
    value,
    expiresAt: Date.now() + EMAIL_BRANDING_CACHE_TTL_MS,
  });
  return value;
};

const invalidateTenantBrandingCache = (tenantId) => {
  emailBrandingCache.delete(String(tenantId));
};

// Strips characters that could break or inject into the From header.
const sanitizeFromName = (value) =>
  String(value || "")
    .replace(/[\u0000-\u001f\u007f"<>\\]/g, "")
    .trim()
    .slice(0, 64);

const wrapBrandedEmail = (branding, innerHtml) => {
  if (!branding) return innerHtml;

  const name = escapeHtml(branding.displayName);
  const color = HEX_COLOR_PATTERN.test(branding.primaryColor || "")
    ? branding.primaryColor
    : DEFAULT_PRIMARY_COLOR;
  const header = branding.logoUrl
    ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${name}" style="display:block;max-height:48px;max-width:200px;border:0;" />`
    : `<span style="font-size:20px;font-weight:700;color:${color};">${name}</span>`;
  const footerLink = branding.appUrl
    ? ` &middot; <a href="${escapeHtml(branding.appUrl)}" style="color:${color};text-decoration:none;">${escapeHtml(branding.appUrl.replace(/^https?:\/\//, ""))}</a>`
    : "";

  return `
<div style="background:#f4f5f7;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-top:4px solid ${color};border-radius:6px;overflow:hidden;">
    <div style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">${header}</div>
    <div style="padding:24px;color:#111827;font-size:15px;line-height:1.5;">${innerHtml}</div>
    <div style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px;">Sent by ${name}${footerLink}</div>
  </div>
</div>`;
};

module.exports = {
  HEX_COLOR_PATTERN,
  BRANDING_SELECT,
  escapeHtml,
  getPublicBranding,
  parseBrandingUpdate,
  getEmailBranding,
  invalidateTenantBrandingCache,
  sanitizeFromName,
  wrapBrandedEmail,
};
