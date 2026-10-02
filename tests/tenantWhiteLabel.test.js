const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateSubdomain,
  slugifySubdomain,
  extractSubdomainFromHost,
  isTenantSubdomainOrigin,
  buildTenantAppUrl,
  getRequestTenantSubdomain,
} = require("../utils/tenantDomainUtils");
const {
  parseBrandingUpdate,
  sanitizeFromName,
  wrapBrandedEmail,
} = require("../utils/tenantBranding");

const withEnv = (vars, fn) => {
  const previous = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test("validates subdomains", () => {
  assert.equal(validateSubdomain("abc-home-care"), null);
  assert.ok(validateSubdomain("ab"));
  assert.ok(validateSubdomain("-abc"));
  assert.ok(validateSubdomain("abc--care"));
  assert.ok(validateSubdomain("abc.care"));
  assert.ok(validateSubdomain("www"));
  assert.ok(validateSubdomain("api"));
});

test("slugifies tenant names into subdomains", () => {
  assert.equal(slugifySubdomain("ABC Home Care, LLC"), "abc-home-care-llc");
  assert.equal(slugifySubdomain("Café & Co"), "cafe-and-co");
  assert.equal(slugifySubdomain("AB"), "ab-team");
  assert.equal(slugifySubdomain("Admin"), "admin-team");
  assert.equal(slugifySubdomain("!!!"), "team");
});

test("extracts tenant subdomain only from the configured root domain", () => {
  withEnv({ TENANT_ROOT_DOMAIN: "wisershifts.com" }, () => {
    assert.equal(extractSubdomainFromHost("abc.wisershifts.com"), "abc");
    assert.equal(extractSubdomainFromHost("ABC.wisershifts.com:443"), "abc");
    assert.equal(extractSubdomainFromHost("abc.localhost:5173"), "abc");
    assert.equal(extractSubdomainFromHost("wisershifts.com"), null);
    assert.equal(extractSubdomainFromHost("www.wisershifts.com"), null);
    assert.equal(extractSubdomainFromHost("a.b.wisershifts.com"), null);
    assert.equal(extractSubdomainFromHost("abc.evil-wisershifts.com"), null);
    assert.equal(extractSubdomainFromHost("abc.wisershifts.com.evil.io"), null);
  });
});

test("allows only https tenant origins in production", () => {
  withEnv(
    { TENANT_ROOT_DOMAIN: "wisershifts.com", NODE_ENV: "production" },
    () => {
      assert.equal(
        isTenantSubdomainOrigin("https://abc.wisershifts.com"),
        true,
      );
      assert.equal(
        isTenantSubdomainOrigin("http://abc.wisershifts.com"),
        false,
      );
      assert.equal(isTenantSubdomainOrigin("https://wisershifts.com"), false);
      assert.equal(
        isTenantSubdomainOrigin("https://abc.wisershifts.com.evil.io"),
        false,
      );
    },
  );
  withEnv({ TENANT_ROOT_DOMAIN: undefined }, () => {
    assert.equal(isTenantSubdomainOrigin("https://abc.wisershifts.com"), false);
  });
});

test("builds tenant app URLs from env", () => {
  withEnv(
    {
      TENANT_ROOT_DOMAIN: "localhost",
      TENANT_APP_URL_SCHEME: "http",
      TENANT_APP_URL_PORT: "5173",
    },
    () => {
      assert.equal(buildTenantAppUrl("abc"), "http://abc.localhost:5173");
    },
  );
  withEnv({ TENANT_ROOT_DOMAIN: undefined }, () => {
    assert.equal(buildTenantAppUrl("abc"), null);
  });
});

test("scopes requests by explicit subdomain or origin", () => {
  withEnv({ TENANT_ROOT_DOMAIN: "wisershifts.com" }, () => {
    assert.equal(
      getRequestTenantSubdomain({
        body: { tenantSubdomain: "ABC" },
        headers: {},
      }),
      "abc",
    );
    assert.equal(
      getRequestTenantSubdomain({
        body: {},
        headers: { origin: "https://xyz.wisershifts.com" },
      }),
      "xyz",
    );
    assert.equal(
      getRequestTenantSubdomain({
        body: {},
        headers: { origin: "https://wisershifts.com" },
      }),
      null,
    );
  });
});

test("parses partial branding updates", () => {
  const { set, errors } = parseBrandingUpdate({
    primaryColor: "#1A2B3C",
    secondaryColor: null,
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(set, {
    "branding.primaryColor": "#1a2b3c",
    "branding.secondaryColor": null,
  });

  const invalid = parseBrandingUpdate({
    primaryColor: "red",
    displayName: "x".repeat(81),
  });
  assert.equal(invalid.errors.length, 2);
});

test("sanitizes email from names and escapes branded layout", () => {
  assert.equal(sanitizeFromName('Evil"\r\nBcc: <x@y.z>'), "EvilBcc: x@y.z");

  const html = wrapBrandedEmail(
    { displayName: "<b>ABC</b>", primaryColor: "red;x", logoUrl: null },
    "<p>Hi</p>",
  );
  assert.ok(html.includes("&lt;b&gt;ABC&lt;/b&gt;"));
  assert.ok(!html.includes("red;x"));
  assert.ok(html.includes("<p>Hi</p>"));
});
