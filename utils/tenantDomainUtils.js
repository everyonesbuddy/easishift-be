const Tenant = require("../models/tenantModel");

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const SUBDOMAIN_MAX_LENGTH = 40;

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "administrator",
  "auth",
  "login",
  "signup",
  "account",
  "accounts",
  "billing",
  "dashboard",
  "docs",
  "help",
  "support",
  "status",
  "mail",
  "email",
  "smtp",
  "ftp",
  "static",
  "assets",
  "cdn",
  "media",
  "files",
  "blog",
  "dev",
  "staging",
  "test",
  "demo",
  "beta",
  "internal",
  "root",
  "system",
  "superadmin",
  "public",
  "secure",
  "tenants",
  "wisershifts",
  "easishift",
]);

const normalizeSubdomain = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Returns an error message, or null when the subdomain is valid.
const validateSubdomain = (value) => {
  const subdomain = normalizeSubdomain(value);
  if (!subdomain) return "subdomain is required";
  if (subdomain.length < 3 || subdomain.length > SUBDOMAIN_MAX_LENGTH) {
    return `subdomain must be 3-${SUBDOMAIN_MAX_LENGTH} characters`;
  }
  if (!SUBDOMAIN_PATTERN.test(subdomain) || subdomain.includes("--")) {
    return "subdomain may only contain lowercase letters, numbers, and single hyphens, and must start and end with a letter or number";
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return "subdomain is reserved";
  }
  return null;
};

const slugifySubdomain = (name) => {
  let slug = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SUBDOMAIN_MAX_LENGTH - 5)
    .replace(/-+$/g, "");

  if (!slug) return "team";
  if (slug.length < 3 || RESERVED_SUBDOMAINS.has(slug)) {
    slug = `${slug}-team`;
  }
  return slug;
};

const isSubdomainAvailable = async (subdomain, excludeTenantId = null) => {
  const query = { subdomain: normalizeSubdomain(subdomain) };
  if (excludeTenantId) query._id = { $ne: excludeTenantId };
  return !(await Tenant.exists(query));
};

const generateUniqueSubdomain = async (name, excludeTenantId = null) => {
  const base = slugifySubdomain(name);
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (await isSubdomainAvailable(candidate, excludeTenantId)) {
      return candidate;
    }
  }
  const random = Math.random().toString(36).slice(2, 6);
  return `${base}-${random}`;
};

const getRootDomain = () =>
  String(process.env.TENANT_ROOT_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");

// Extracts "<sub>" from "<sub>.<root>" or "<sub>.localhost"; null otherwise.
const extractSubdomainFromHost = (host) => {
  const hostname = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (!hostname) return null;

  const suffixes = ["localhost"];
  const rootDomain = getRootDomain();
  if (rootDomain) suffixes.unshift(rootDomain);

  for (const suffix of suffixes) {
    if (!hostname.endsWith(`.${suffix}`)) continue;
    const label = hostname.slice(0, -(suffix.length + 1));
    if (!label || label.includes(".")) return null;
    return validateSubdomain(label) ? null : label;
  }
  return null;
};

const parseOriginHostname = (origin) => {
  try {
    return new URL(String(origin)).hostname;
  } catch (err) {
    return null;
  }
};

const isTenantSubdomainOrigin = (origin) => {
  const rootDomain = getRootDomain();
  if (!rootDomain || !origin) return false;

  let url;
  try {
    url = new URL(String(origin));
  } catch (err) {
    return false;
  }

  const httpAllowed = process.env.NODE_ENV !== "production";
  if (url.protocol !== "https:" && !(httpAllowed && url.protocol === "http:")) {
    return false;
  }
  if (!url.hostname.endsWith(`.${rootDomain}`)) return false;
  return Boolean(extractSubdomainFromHost(url.hostname));
};

const buildTenantAppUrl = (subdomain) => {
  const rootDomain = getRootDomain();
  if (!rootDomain || !subdomain) return null;

  const scheme = process.env.TENANT_APP_URL_SCHEME || "https";
  const port = process.env.TENANT_APP_URL_PORT
    ? `:${process.env.TENANT_APP_URL_PORT}`
    : "";
  return `${scheme}://${subdomain}.${rootDomain}${port}`;
};

const getDefaultAppUrl = () =>
  (process.env.FRONTEND_BASE_URL || process.env.FRONTEND_URL || "").replace(
    /\/+$/,
    "",
  );

const getTenantAppUrl = (tenant) =>
  buildTenantAppUrl(tenant?.subdomain) || getDefaultAppUrl() || null;

// Tenant subdomain a request is scoped to: explicit body value (mobile) or browser Origin.
const getRequestTenantSubdomain = (req) => {
  // An invalid explicit value still scopes the request, so it matches no tenant.
  const explicit = normalizeSubdomain(req.body?.tenantSubdomain);
  if (explicit) return explicit;

  const originHost = parseOriginHostname(req.headers?.origin);
  return originHost ? extractSubdomainFromHost(originHost) : null;
};

module.exports = {
  RESERVED_SUBDOMAINS,
  normalizeSubdomain,
  validateSubdomain,
  slugifySubdomain,
  isSubdomainAvailable,
  generateUniqueSubdomain,
  getRootDomain,
  extractSubdomainFromHost,
  isTenantSubdomainOrigin,
  buildTenantAppUrl,
  getTenantAppUrl,
  getRequestTenantSubdomain,
};
