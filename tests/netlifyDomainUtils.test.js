const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTenantHostname,
  updateNetlifyTenantAliases,
} = require("../utils/netlifyDomainUtils");

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test("builds a tenant hostname only for valid subdomains", () => {
  assert.equal(
    buildTenantHostname("Olutayo-Hospital", "wisershifts.com"),
    "olutayo-hospital.wisershifts.com",
  );
  assert.equal(buildTenantHostname("a.b", "wisershifts.com"), null);
  assert.equal(buildTenantHostname("www", "wisershifts.com"), null);
});

test("adds an alias while preserving existing Netlify domains", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (!options.method) {
      return response(200, {
        domain_aliases: ["easishift.com", "www.wisershifts.com"],
      });
    }
    return response(200, {});
  };

  const result = await updateNetlifyTenantAliases({
    addSubdomains: ["Silver-Comet"],
    fetchImpl,
    env: {
      TENANT_ROOT_DOMAIN: "wisershifts.com",
      NETLIFY_SITE_ID: "site-id",
      NETLIFY_AUTH_TOKEN: "test-token",
    },
  });

  assert.equal(result.status, "updated");
  assert.deepEqual(result.added, ["silver-comet.wisershifts.com"]);
  assert.deepEqual(result.removed, []);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(calls[1].options.body).domain_aliases, [
    "easishift.com",
    "www.wisershifts.com",
    "silver-comet.wisershifts.com",
  ]);
});

test("is idempotent and can remove a prior tenant alias", async () => {
  let updateBody;
  const fetchImpl = async (_url, options) => {
    if (!options.method) {
      return response(200, {
        domain_aliases: [
          "olutayo-hospital.wisershifts.com",
          "www.wisershifts.com",
        ],
      });
    }
    updateBody = JSON.parse(options.body);
    return response(200, {});
  };

  const result = await updateNetlifyTenantAliases({
    addSubdomains: ["silver-comet"],
    removeSubdomains: ["olutayo-hospital"],
    fetchImpl,
    env: {
      TENANT_ROOT_DOMAIN: "wisershifts.com",
      NETLIFY_SITE_ID: "site-id",
      NETLIFY_AUTH_TOKEN: "test-token",
    },
  });

  assert.deepEqual(result.added, ["silver-comet.wisershifts.com"]);
  assert.deepEqual(result.removed, ["olutayo-hospital.wisershifts.com"]);
  assert.deepEqual(updateBody.domain_aliases, [
    "www.wisershifts.com",
    "silver-comet.wisershifts.com",
  ]);
});

test("does not call Netlify when configuration is missing or local", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(200, {});
  };

  const missingConfig = await updateNetlifyTenantAliases({
    addSubdomains: ["abc"],
    fetchImpl,
    env: {},
  });
  const localDomain = await updateNetlifyTenantAliases({
    addSubdomains: ["abc"],
    fetchImpl,
    env: {
      TENANT_ROOT_DOMAIN: "localhost",
      NETLIFY_SITE_ID: "site-id",
      NETLIFY_AUTH_TOKEN: "test-token",
    },
  });

  assert.equal(missingConfig.status, "not_configured");
  assert.equal(localDomain.status, "local_domain_skipped");
  assert.equal(calls, 0);
});
