const {
  normalizeSubdomain,
  validateSubdomain,
} = require("./tenantDomainUtils");

const NETLIFY_API_BASE_URL = "https://api.netlify.com/api/v1";

const getNetlifyDomainConfig = (env = process.env) => ({
  rootDomain: String(env.TENANT_ROOT_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, ""),
  siteId: String(env.NETLIFY_SITE_ID || "").trim(),
  authToken: String(env.NETLIFY_AUTH_TOKEN || "").trim(),
});

const buildTenantHostname = (subdomain, rootDomain) => {
  const normalized = normalizeSubdomain(subdomain);
  if (!normalized || validateSubdomain(normalized)) return null;
  if (!rootDomain) return null;
  return `${normalized}.${rootDomain}`;
};

const normalizeHostname = (hostname) =>
  String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

const getResponseError = async (response) => {
  let detail = "";
  try {
    detail = await response.text();
  } catch (err) {
    detail = "";
  }
  return detail.slice(0, 300);
};

const updateNetlifyTenantAliases = async ({
  addSubdomains = [],
  removeSubdomains = [],
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) => {
  const { rootDomain, siteId, authToken } = getNetlifyDomainConfig(env);
  const result = {
    status: "not_configured",
    added: [],
    removed: [],
  };

  if (!rootDomain || !siteId || !authToken) return result;
  if (rootDomain === "localhost" || rootDomain.endsWith(".localhost")) {
    return { ...result, status: "local_domain_skipped" };
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Netlify domain sync requires Node.js fetch support");
  }

  const additions = Array.from(
    new Set(
      addSubdomains
        .map((subdomain) => buildTenantHostname(subdomain, rootDomain))
        .filter(Boolean),
    ),
  );
  const removals = Array.from(
    new Set(
      removeSubdomains
        .map((subdomain) => buildTenantHostname(subdomain, rootDomain))
        .filter(Boolean),
    ),
  ).filter((hostname) => !additions.includes(hostname));

  if (!additions.length && !removals.length) {
    return { ...result, status: "no_valid_hostnames" };
  }

  const endpoint = `${NETLIFY_API_BASE_URL}/sites/${encodeURIComponent(siteId)}`;
  const signal = AbortSignal.timeout(8000);
  const headers = {
    Authorization: `Bearer ${authToken}`,
    Accept: "application/json",
  };

  const currentResponse = await fetchImpl(endpoint, { headers, signal });
  if (!currentResponse.ok) {
    const detail = await getResponseError(currentResponse);
    throw new Error(
      `Netlify site lookup failed (${currentResponse.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const site = await currentResponse.json();
  const currentAliases = Array.isArray(site.domain_aliases)
    ? site.domain_aliases.map(normalizeHostname).filter(Boolean)
    : [];
  const removeSet = new Set(removals);
  const nextAliases = currentAliases.filter((alias) => !removeSet.has(alias));
  const aliasSet = new Set(nextAliases);

  for (const hostname of additions) {
    if (!aliasSet.has(hostname)) {
      nextAliases.push(hostname);
      aliasSet.add(hostname);
    }
  }

  const nextSet = new Set(nextAliases);
  const added = additions.filter(
    (hostname) => !currentAliases.includes(hostname),
  );
  const removed = currentAliases.filter((hostname) => removeSet.has(hostname));

  if (!added.length && !removed.length) {
    return { status: "already_configured", added: [], removed: [] };
  }

  const updateResponse = await fetchImpl(endpoint, {
    method: "PATCH",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({ domain_aliases: nextAliases }),
  });
  if (!updateResponse.ok) {
    const detail = await getResponseError(updateResponse);
    throw new Error(
      `Netlify domain alias update failed (${updateResponse.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  return {
    status: "updated",
    added,
    removed,
    aliases: Array.from(nextSet),
  };
};

module.exports = {
  getNetlifyDomainConfig,
  buildTenantHostname,
  updateNetlifyTenantAliases,
};
