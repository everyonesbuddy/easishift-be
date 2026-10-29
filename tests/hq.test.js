const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { roleFromTitle } = require("../utils/hq/roles");
const { domainOf } = require("../utils/hq/domain");
const { buildPlays } = require("../utils/hq/plays");
const { normalize } = require("../utils/hq/importCsv");
const { matchFacility } = require("../utils/hq/linkSignups");
const { summarizeWorkspace } = require("../utils/hq/productSignals");
const { isBotClick } = require("../utils/hq/klaviyo");
const { signJwt } = require("../utils/hq/google");

const DAY = 86400000;
const NOW = new Date("2026-10-29T15:00:00Z");
const ago = (d) => new Date(NOW - d * DAY);

test("job titles sort into buyer roles", () => {
  assert.equal(roleFromTitle("Director of Nursing"), "don");
  assert.equal(roleFromTitle("DON"), "don");
  assert.equal(roleFromTitle("Executive Director"), "executive_director");
  assert.equal(roleFromTitle("Regional Director of Operations"), "regional");
  assert.equal(roleFromTitle("VP of Operations"), "regional");
  assert.equal(roleFromTitle("Licensed Nursing Home Administrator"), "administrator");
  assert.equal(roleFromTitle("Staffing Coordinator"), "scheduler");
  assert.equal(roleFromTitle("Owner"), "owner");
  assert.equal(roleFromTitle("Activities Assistant"), "other");
  assert.equal(roleFromTitle(""), "other");
});

test("company domain from websites and emails, not free mail", () => {
  assert.equal(domainOf("https://www.Edenwald.org/about"), "edenwald.org");
  assert.equal(domainOf('=HYPERLINK("https://kendal.org","kendal.org")'), "kendal.org");
  assert.equal(domainOf("mbeggs@edenwald.org"), "edenwald.org");
  assert.equal(domainOf("someone@gmail.com"), "");
  assert.equal(domainOf("not a url"), "");
});

test("Klaviyo scanner clicks are told apart from real clicks", () => {
  assert.equal(isBotClick({ "Bot Click": true }), true);
  assert.equal(isBotClick({ "Bot Click": false }), false);
  assert.equal(isBotClick({}), false);
});

test("Google service-account JWT is a valid RS256 signature", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const jwt = signJwt({ email: "sa@x.iam.gserviceaccount.com", key: pem }, "scope-a", 1000);
  const [h, c, sig] = jwt.split(".");
  const ok = crypto.createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"));
  assert.equal(ok, true);
  const claim = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.equal(claim.iss, "sa@x.iam.gserviceaccount.com");
  assert.equal(claim.exp, 4600);
});

test("call-list CSV (title row, HYPERLINK, US dates) normalizes", () => {
  const csv = [
    "1 Close First,,,,,",
    "Call ID,Score,Building,City,State,Group,Buildings in Group,Group Website,Stage,Next Date,Scheduler Name,Scheduler Email",
    'C-0001,88,Maple Grove,Dayton,OH,Acme Senior,6,"=HYPERLINK(""https://acme.com"",""acme.com"")",Got scheduler name,11/3/2026,Pat Kim,PAT@ACME.COM',
    ",,,,,,,,,,,",
  ].join("\n");
  const { rows, matchedColumns } = normalize("facilities", csv, { defaultTier: 1 });
  assert.ok(matchedColumns.includes("callid"));
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.ref, "C-0001");
  assert.equal(r.tier, 1);
  assert.equal(r.website, "https://acme.com");
  assert.equal(r.domain, "acme.com");
  assert.equal(r.buildingsInGroup, 6);
  assert.equal(r.nextDate.toISOString().slice(0, 10), "2026-11-03");
  assert.equal(r.scheduler.email, "pat@acme.com");
});

test("Lead Bank CSV gets roles from titles", () => {
  const csv = [
    "Lead ID,Ownership Group / Company,Facility (Entry Point),Contact Name,Contact Title,Contact Email,Priority",
    "L-0001,Acme Senior,Maple Grove,Dana Lee,Director of Nursing,dana@acme.com,High",
    "L-0002,Acme Senior,,Sam Roe,Regional VP,bad-email,",
  ].join("\n");
  const { rows } = normalize("contacts", csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].role, "don");
  assert.equal(rows[0].facilityName, "Maple Grove");
  assert.equal(rows[1].role, "regional");
  assert.equal(rows[1].email, "");
});

test("Outreach CSV keeps only rows with something that happened", () => {
  const csv = [
    "Lead ID,Contact Email,Call Date,Call Outcome,Email Reply,Notes",
    "L-0001,dana@acme.com,10/20/2026,Voicemail,,",
    "L-0002,sam@acme.com,,,,",
  ].join("\n");
  const { rows } = normalize("activities", csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].callOutcome, "Voicemail");
});

test("LinkedIn export: posts with a URL", () => {
  const csv = ["Post URL,Post publish date,Impressions,Engagements", "https://www.linkedin.com/feed/update/1,10/1/2026,1520,44", "Total,,1520,44"].join("\n");
  const { rows } = normalize("linkedin", csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].impressions, 1520);
  assert.equal(rows[0].reactions, 44);
});

test("unknown import kind is refused", () => {
  assert.throws(() => normalize("nope", "a,b"), /Unknown import kind/);
});

test("signups match a listed facility by name, else by single-building domain", () => {
  const facilities = [
    { _id: "f1", name: "Maple Grove", domain: "acme.com", tenantId: null },
    { _id: "f2", name: "Oak Hill", domain: "acme.com", tenantId: null },
    { _id: "f3", name: "Kendal at Ithaca", domain: "kendal.org", tenantId: null },
  ];
  assert.equal(matchFacility({ name: "Maple-Grove", ownerEmail: "x@gmail.com" }, facilities)._id, "f1");
  assert.equal(matchFacility({ name: "Some Name", ownerEmail: "x@kendal.org" }, facilities)._id, "f3");
  // Two buildings share acme.com: don't guess.
  assert.equal(matchFacility({ name: "Riverside", ownerEmail: "x@acme.com" }, facilities), null);
});

const tenant = (over = {}) => ({ _id: "t1", name: "Maple Grove", email: "pat@acme.com", createdAt: ago(10), setupCompletedAt: ago(9), plan: "free", subscriptionStatus: "inactive", trialEndsAt: null, ...over });

test("workspace summary: active, leadership reached", () => {
  const w = summarizeWorkspace({
    tenant: tenant({ signupRole: "scheduler" }),
    members: [{ name: "Pat", email: "pat@acme.com", roles: ["owner"], lastSeenAt: ago(1) }],
    now: NOW,
  });
  assert.equal(w.active, true);
  assert.equal(w.leadershipReached, false);
  const w2 = summarizeWorkspace({
    tenant: tenant({ signupRole: "scheduler" }),
    members: [{ name: "Pat", email: "pat@acme.com", roles: ["owner"], lastSeenAt: ago(30) }],
    laborSettings: { mondayReport: { enabled: true, extraRecipients: ["ed@acme.com"] } },
    shifts14: 2,
    now: NOW,
  });
  assert.equal(w2.active, false);
  assert.equal(w2.leadershipReached, true);
  assert.equal(summarizeWorkspace({ tenant: tenant({ signupRole: "don" }), now: NOW }).leadershipReached, true);
});

const ws = (over = {}) => ({
  tenantId: "t1", name: "Maple Grove", ownerName: "Pat", ownerEmail: "pat@acme.com", createdAt: ago(10),
  setupDone: true, active: true, leadershipReached: false, paid: false, trialDaysLeft: null, lastActiveAt: ago(1), signupRole: "scheduler", ...over,
});

test("plays: stuck in setup → help call", () => {
  const plays = buildPlays({ workspaces: [ws({ setupDone: false, createdAt: ago(3) })], now: NOW });
  assert.equal(plays.length, 1);
  assert.equal(plays[0].kind, "help");
  assert.equal(plays[0].priority, 1);
});

test("plays: scheduler active, no leadership → reach the DON at that building", () => {
  const facilities = [{ _id: "f1", name: "Maple Grove", tenantId: "t1" }];
  const contacts = [
    { _id: "c1", name: "Ed Wu", title: "Executive Director", role: "executive_director", facilityId: "f1", email: "ed@acme.com" },
    { _id: "c2", name: "Dana Lee", title: "DON", role: "don", facilityId: "f1", email: "dana@acme.com" },
  ];
  const plays = buildPlays({ workspaces: [ws()], facilities, contacts, now: NOW });
  const p = plays.find((x) => x.kind === "expand");
  assert.ok(p);
  assert.equal(p.contactId, "c2");
  assert.equal(p.role, "don");
});

test("plays: leadership reached and active on Free → upgrade ask; trial ending → today", () => {
  let plays = buildPlays({ workspaces: [ws({ leadershipReached: true })], now: NOW });
  assert.equal(plays[0].kind, "upgrade");
  assert.equal(plays[0].priority, 2);
  plays = buildPlays({ workspaces: [ws({ leadershipReached: true, trialDaysLeft: 3, trialEndsAt: "2026-11-01" })], now: NOW });
  assert.equal(plays[0].priority, 1);
});

test("plays: real clicks → personal note; scanner clicks don't count; recent touch hides it", () => {
  const contacts = [
    { _id: "c1", name: "Mia", email: "mia@kendal.org", role: "executive_director" },
    { _id: "c2", name: "Bo", email: "bo@x.org", role: "don" },
  ];
  const signals = {
    "mia@kendal.org": { humanClicks: 3, botClicks: 0, lastHumanClickAt: ago(10) },
    "bo@x.org": { humanClicks: 0, botClicks: 12 },
  };
  let plays = buildPlays({ contacts, signals, now: NOW });
  assert.equal(plays.length, 1);
  assert.equal(plays[0].contactId, "c1");
  plays = buildPlays({ contacts, signals, lastTouch: { c1: ago(2) }, now: NOW });
  assert.equal(plays.length, 0);
});

test("plays: two engaged buildings in one group → operator pitch", () => {
  const contacts = [
    { _id: "c1", email: "a@acme.com", group: "Acme Senior", facilityId: "f1", role: "don" },
    { _id: "c2", email: "b@acme.com", group: "Acme Senior", facilityId: "f2", role: "executive_director" },
    { _id: "c3", name: "Vic", email: "vp@acme.com", group: "Acme Senior", role: "regional" },
  ];
  const signals = { "a@acme.com": { humanClicks: 1 }, "b@acme.com": { humanClicks: 1 } };
  const plays = buildPlays({ contacts, signals, now: NOW });
  const op = plays.find((p) => p.kind === "operator");
  assert.ok(op);
  assert.equal(op.contactId, "c3");
});

test("plays: due call-list follow-ups, not dead ones; done plays stay hidden", () => {
  const facilities = [
    { _id: "f1", name: "Maple", tier: 1, stage: "Got scheduler name", nextDate: ago(1), nextStep: "Call back" },
    { _id: "f2", name: "Oak", tier: 1, stage: "Not interested", nextDate: ago(1) },
    { _id: "f3", name: "Elm", tier: 3, stage: "Trying", nextDate: new Date(NOW.getTime() + 3 * DAY) },
  ];
  const plays = buildPlays({ facilities, now: NOW });
  assert.deepEqual(plays.map((p) => p.facilityId), ["f1"]);
  assert.equal(buildPlays({ facilities, doneKeys: new Set([plays[0].key]), now: NOW }).length, 0);
});

test("import: typo dates are dropped; RVP is regional; merged title rows are skipped", () => {
  const { toDate } = require("../utils/hq/importCsv");
  assert.equal(toDate("90/25/2026"), null);
  assert.equal(toDate("09/28/2026").toISOString().slice(0, 10), "2026-09-28");
  assert.equal(roleFromTitle("RVP of Operations"), "regional");
  assert.equal(roleFromTitle("Director of Business Operations"), "regional");
  const csv = ['"TIER 1: call first","TIER 1: call first","TIER 1: call first","TIER 1: call first"', "Call ID,Building,City,State,Old Lead ID", "C-0001,Annandale,Suwanee,GA,L-0052"].join("\n");
  const { rows } = normalize("facilities", csv);
  assert.equal(rows[0].name, "Annandale");
  assert.equal(rows[0].leadRef, "L-0052");
});

test("HQ and workspace sessions never open each other", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
  const jwt = require("jsonwebtoken");
  const { hqAuth, signHqToken } = require("../middleware/hqAuthMiddleware");
  const run = async (mw, token) => {
    let status = null;
    let passed = false;
    const res = { status: (s) => ((status = s), { json: () => {} }) };
    await mw({ headers: { authorization: `Bearer ${token}` }, cookies: {} }, res, () => (passed = true));
    return { status, passed };
  };
  // A workspace token is refused by HQ (no HQ marker/audience).
  const workspaceToken = jwt.sign({ id: "66f000000000000000000001", tenantId: "t" }, process.env.JWT_SECRET);
  assert.deepEqual(await run(hqAuth, workspaceToken), { status: 401, passed: false });
  // An HQ token is refused by workspace auth before any lookup.
  const workspaceAuth = require("../middleware/authMiddleware");
  const hqToken = signHqToken({ _id: "66f000000000000000000002" });
  assert.deepEqual(await run(workspaceAuth, hqToken), { status: 401, passed: false });
});
