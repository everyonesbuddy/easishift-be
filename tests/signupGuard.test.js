const test = require("node:test");
const assert = require("node:assert/strict");
const { checkSignup, looksLikeGibberish, containsLink } = require("../utils/signupGuard");

const real = { name: "Joseph Adeyemo", facilityName: "Silver Comet Senior Living", email: "j@example.com", password: "longenough" };

test("random mixed-case names from the bot signups are caught", () => {
  for (const s of ["HuUdlfYLqgJilqaFoDcufSp", "TCocOwXprLsThDIiROkTmPCQ", "WVdnfJMTqIjVhXCDBoP"]) {
    assert.equal(looksLikeGibberish(s), true, s);
  }
});

test("real names and facility names pass", () => {
  for (const s of ["Joseph Adeyemo", "McDonald", "DeShawn", "MacKenzie", "O'Brien", "Brookdale", "VanderMeer", "Sunrise of Plano", "LaToya", "JoAnn", "Mary-Kate", "Nguyen"]) {
    assert.equal(looksLikeGibberish(s), false, s);
  }
  assert.deepEqual(checkSignup(real), { ok: true });
});

test("honeypot, too fast, and gibberish are blocked; the app (no extra fields) is not", () => {
  assert.equal(checkSignup({ ...real, website: "http://x" }).reason, "honeypot");
  const now = 1_000_000;
  assert.equal(checkSignup({ ...real, formStartedAt: now - 900 }, now).reason, "too_fast");
  assert.equal(checkSignup({ ...real, formStartedAt: now - 15_000 }, now).ok, true);
  assert.equal(checkSignup({ ...real, website: "" }).ok, true);
  const g = checkSignup({ ...real, name: "HuUdlfYLqgJilqaFoDcufSp" });
  assert.equal(g.reason, "gibberish_name");
  assert.match(g.message, /real name/);
  // Old app shape: adminName + name (facility).
  assert.equal(checkSignup({ adminName: "WVdnfJMTqIjVhXCDBoP", name: "Oak Grove" }).ok, false);
});

test("signup controller refuses a bot before touching the database", async () => {
  const Tenant = require("../models/tenantModel");
  const User = require("../models/userModel");
  const orig = { t: Tenant.create, u: User.findOne };
  let touched = false;
  Tenant.create = async () => { touched = true; };
  User.findOne = () => { touched = true; return { select: () => ({ lean: async () => null }) }; };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { registerTenant } = require("../controllers/authController");
    let status, body;
    const res = { status: (s) => { status = s; return res; }, json: (b) => { body = b; } };
    await registerTenant({ ip: "1.2.3.4", body: { ...real, name: "TCocOwXprLsThDIiROkTmPCQ", termsAccepted: true } }, res, (e) => { throw e; });
    assert.equal(status, 400);
    assert.equal(body.errorCode, "SIGNUP_BLOCKED");
    assert.equal(touched, false);
  } finally {
    Tenant.create = orig.t;
    User.findOne = orig.u;
    console.warn = warn;
  }
});

test("links and HTML in names are refused; ordinary names with dots are not", () => {
  for (const s of ["Free gift at spam-site.com", "http://x.y", "www.win-now", "Claim <a href=x>prize</a>", "bit.ly/abc offer.xyz"]) {
    assert.equal(containsLink(s), true, s);
  }
  for (const s of ["St. Mary's Assisted Living", "Dr. Ana Diaz", "J.R. Smith", "Sunrise of Plano", "Oak Grove Co-op", "Mt. Vernon Care"]) {
    assert.equal(containsLink(s), false, s);
  }
  assert.equal(checkSignup({ ...real, facilityName: "Cheap meds at pills.shop" }).reason, "link_in_name");
});

test("names in emails are escaped", () => {
  const { escapeHtml } = require("../utils/notify");
  assert.equal(escapeHtml('<a href="x">Win</a>'), "&lt;a href=&quot;x&quot;&gt;Win&lt;/a&gt;");
  const src = require("node:fs").readFileSync(require.resolve("../controllers/authController"), "utf8");
  assert.match(src, /Hi \$\{escapeHtml\(owner\.name\)\}/);
  assert.match(src, /<strong>\$\{escapeHtml\(tenant\.name\)\}<\/strong>/);
});
