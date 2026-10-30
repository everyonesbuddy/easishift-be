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

test("re-import only writes what the sheet changed, so HQ edits survive", () => {
  const { changedFields } = require("../utils/hq/importCsv");
  const sheetBefore = { name: "Maple", stage: "Trying", nextDate: "2026-11-01" };
  // First import: everything.
  assert.deepEqual(changedFields(sheetBefore, null), sheetBefore);
  // Sheet unchanged (HQ moved the stage meanwhile): nothing written.
  assert.deepEqual(changedFields({ ...sheetBefore }, sheetBefore), {});
  // Sheet changed the next date only: only that is written.
  assert.deepEqual(changedFields({ ...sheetBefore, nextDate: "2026-11-05" }, sheetBefore), { nextDate: "2026-11-05" });
});

test("Google Sheet tabs: kind guessed from the tab name; links and rows become CSV", () => {
  const { guessTab, cleanSources } = require("../utils/hq/sheetSync");
  const { rowsToCsv } = require("../utils/hq/importCsv");
  const { spreadsheetIdFrom } = require("../utils/hq/google");
  assert.deepEqual(guessTab("2 Next Up"), { kind: "facilities", tier: 2 });
  assert.equal(guessTab("Lead Bank").kind, "contacts");
  assert.equal(guessTab("Outreach").kind, "activities");
  assert.equal(guessTab("Dashboard").kind, "");
  assert.equal(spreadsheetIdFrom("https://docs.google.com/spreadsheets/d/1btxuNDMsvSXnBuYc2qM_tP8HOq3bLr_tL5Qe7c147v0/edit?usp=sharing"), "1btxuNDMsvSXnBuYc2qM_tP8HOq3bLr_tL5Qe7c147v0");
  assert.equal(spreadsheetIdFrom("not a sheet"), "");
  assert.deepEqual(
    cleanSources([{ url: "https://docs.google.com/spreadsheets/d/1btxuNDMsvSXnBuYc2qM_tP8HOq3bLr_tL5Qe7c147v0/edit", tab: "Lead Bank", kind: "contacts" }, { spreadsheetId: "x", tab: "A", kind: "nope" }]).length,
    1,
  );
  assert.equal(rowsToCsv([["Lead ID", "Notes"], ["L-1", 'said "hi", call back']]), 'Lead ID,Notes\nL-1,"said ""hi"", call back"');
});

test("weeks: Monday buckets in the team's time zone", () => {
  const { lastWeeks, bucket } = require("../utils/hq/weeks");
  const weeks = lastWeeks(2, new Date("2026-10-29T15:00:00Z"));
  assert.deepEqual(weeks.map((w) => w.key), ["2026-10-19", "2026-10-26"]);
  // Sunday 11 p.m. New York is still the earlier week.
  const counts = bucket(weeks, [new Date("2026-10-26T03:30:00Z"), new Date("2026-10-27T15:00:00Z"), null, new Date("2025-01-01")]);
  assert.deepEqual(counts, { "2026-10-19": 1, "2026-10-26": 1 });
});

test("content numbers are matched by link", () => {
  const { metricsFor, youtubeId } = require("../controllers/hqContentPlanController");
  assert.equal(youtubeId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assert.equal(youtubeId("https://www.youtube.com/watch?v=abcdefghijk&t=3"), "abcdefghijk");
  const sources = {
    videos: [{ id: "abcdefghijk", views: 120, likes: 4, comments: 1 }],
    pages: [{ pagePath: "/blog/hprd", screenPageViews: 40 }],
    linkedin: [{ url: "https://www.linkedin.com/feed/update/urn:li:activity:1/", impressions: 900, reactions: 20, comments: 3, reposts: 1 }],
  };
  assert.equal(metricsFor({ url: "https://youtu.be/abcdefghijk" }, sources).views, 120);
  assert.equal(metricsFor({ url: "https://wisershifts.com/blog/hprd" }, sources).views, 40);
  assert.equal(metricsFor({ url: "https://www.linkedin.com/feed/update/urn:li:activity:1?utm=x" }, sources).engagement, 24);
  assert.equal(metricsFor({ url: "" }, sources), null);
});

test("signup source label: UTM, then referrer, then what they told us", () => {
  const { sourceLabel } = require("../controllers/hqFunnelController");
  assert.equal(sourceLabel({ signupSource: { utm_source: "LinkedIn" } }), "linkedin");
  assert.equal(sourceLabel({ signupSource: { referrer: "https://www.google.com/" } }), "google.com");
  assert.equal(sourceLabel({ heardAbout: "colleague" }), "a colleague");
  assert.equal(sourceLabel({}), "unknown");
});

test("starting playbook: every content idea points at a real play", () => {
  const { PLAYS, CONTENT } = require("../utils/hq/playbookSeed");
  const keys = new Set(PLAYS.map((p) => p.seedKey));
  assert.equal(keys.size, PLAYS.length);
  for (const c of CONTENT) assert.ok(keys.has(c[5]), c[0]);
  const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
  for (const p of PLAYS) assert.equal(new HqPlaybookPlay(p).validateSync(), undefined, p.seedKey);
});

test("playbook v2: written playbook, 15 LinkedIn posts with their text, and valid content items", () => {
  const { META_V2, CONTENT_V2, PLAYS } = require("../utils/hq/playbookSeed");
  const HqContentItem = require("../models/hqContentItemModel");
  assert.equal(META_V2.buyers.length, 3);
  const posts = CONTENT_V2.filter((c) => c.seedKey.startsWith("li-plan-"));
  assert.equal(posts.length, 15);
  assert.match(posts[0].notes, /^When: Week 1 · Tuesday 11:30 AM ET/);
  assert.match(posts[0].notes, /I didn't know I was on/);
  assert.ok(!posts[0].notes.includes("*"), "markdown stripped");
  const keys = new Set(PLAYS.map((p) => p.seedKey));
  for (const c of CONTENT_V2) {
    assert.ok(keys.has(c.play), c.seedKey);
    const { play, ...item } = c;
    assert.equal(new HqContentItem(item).validateSync(), undefined, c.seedKey);
  }
});

test("playbook v4: a message for each buyer, and no Labor Math newsletter", () => {
  const seed = require("../utils/hq/playbookSeed");
  for (const b of seed.META_V2.buyers) {
    const m = seed.MESSAGING[b.key];
    for (const f of ["promise", "pains", "proof", "angles", "cta", "avoid"]) assert.ok(m?.[f], `${b.key}.${f}`);
  }
  assert.notEqual(seed.MESSAGING.scheduler.promise, seed.MESSAGING.director.promise);
  const all = JSON.stringify([seed.PLAYS, seed.META, seed.CONTENT, seed.V4, seed.MESSAGING]);
  assert.ok(!/Labor Math/.test(all), "no Labor Math left in what we seed");
  const nl = seed.PLAYS.find((p) => p.seedKey === "newsletter");
  assert.equal(nl.weeklyTarget, 1);
  assert.deepEqual(nl.audience, ["scheduler", "director", "operator"]);
  const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
  assert.equal(new HqPlaybookPlay(nl).validateSync(), undefined);
  // Version 4 only replaces text nobody edited.
  assert.equal(seed.PRE_V4.newsletterTitle, "\"The Labor Math\" newsletter");
  assert.ok(seed.META.week.find((w) => w.day === "Tuesday").b.includes("Klaviyo"));
});

test("to-do reasons say what they clicked, what they replied, which calculator they used", () => {
  const { pageName } = require("../utils/hq/plays");
  assert.equal(pageName("https://wisershifts.com/calculators/hours-per-resident-day-calculator?utm_source=klaviyo"), "the hours per resident day calculator");
  assert.equal(pageName("https://wisershifts.com/for/directors"), "the page for directors");
  assert.equal(pageName("not a url"), "");
  const contacts = [
    { _id: "c1", name: "Mia", email: "mia@kendal.org", role: "executive_director", emailReply: "" },
    { _id: "c2", name: "Bo", email: "bo@x.org", role: "don", emailReply: "Send me the snapshot" },
  ];
  const signals = { "mia@kendal.org": { humanClicks: 2, botClicks: 4, lastHumanClickAt: ago(1), lastClickCampaign: "What could 12 minutes per shift be costing your facility?", lastClickUrl: "https://wisershifts.com/calculators/overtime-cost-calculator" } };
  const leads = [{ email: "new@pines.org", company: "Pines", source: "calculator:hours-per-resident-day", summary: "3.41 hours per resident day", createdAt: ago(1), newsletter: true }];
  const plays = buildPlays({ contacts, signals, leads, now: NOW });
  const click = plays.find((p) => p.kind === "personal");
  assert.match(click.why, /Clicked "What could 12 minutes per shift be costing your facility\?" in our weekly Klaviyo email and opened the overtime cost calculator yesterday/);
  assert.match(click.why, /4 scanner clicks we ignore/);
  assert.deepEqual(click.audiences, ["director"]);
  const reply = plays.find((p) => p.kind === "reply");
  assert.match(reply.why, /Send me the snapshot/);
  const lead = plays.find((p) => p.kind === "lead");
  assert.match(lead.why, /hours per resident day calculator yesterday: 3.41/);
  assert.deepEqual(lead.audiences, ["director"]);
});

test("content to-dos: overdue, behind pace with what's next, every-two-weeks due, did well", () => {
  const { buildContentPlays } = require("../utils/hq/contentPlays");
  const plays = [
    { _id: "li", title: "LinkedIn posts", active: true, weeklyTarget: 3, targetUnit: "posts", countsFrom: "content", channel: "linkedin", audience: ["director"], done: 0 },
    { _id: "nl", title: "The newsletter", active: true, weeklyTarget: 0.5, countsFrom: "content", channel: "newsletter", audience: ["director"], done: 0 },
    { _id: "calls", title: "Front desk calls", active: true, weeklyTarget: 60, targetUnit: "calls", countsFrom: "activities", channel: "calls", audience: ["scheduler"], done: 10 },
  ];
  const items = [
    { _id: "i1", title: "Post 2", status: "ready", playId: "li", channel: "linkedin", audience: ["scheduler"], dueDate: ago(2) },
    { _id: "i2", title: "Post 3", status: "drafting", playId: "li", channel: "linkedin", audience: ["scheduler"] },
    ...[100, 120, 900].map((v, k) => ({ _id: `p${k}`, title: `Pub ${k}`, status: "published", publishedAt: ago(5), channel: "linkedin", audience: ["director"], metrics: { source: "LinkedIn", impressions: v } })),
  ];
  const out = buildContentPlays({ items, plays, now: NOW, dayOfWeek: 3, weekKey: "2026-10-26" });
  assert.ok(out.find((p) => p.kind === "overdue" && p.contentId === "i1"));
  const li = out.find((p) => p.playId === "li");
  assert.match(li.title, /0 of 3 posts this week/);
  assert.match(li.action, /3 to go/);
  // The pieces to publish, one at a time: ready first, at most what's left.
  assert.deepEqual(li.queue.map((i) => i.title), ["Post 2", "Post 3"]);
  assert.deepEqual(li.published, []);
  const nl = out.find((p) => p.playId === "nl" && /is due/.test(p.title));
  assert.ok(nl);
  assert.equal(nl.countsFrom, "content");
  assert.match(out.find((p) => p.playId === "calls").action, /50 to go/);
  const well = out.filter((p) => p.kind === "didwell");
  assert.equal(well.length, 1);
  assert.match(well[0].title, /Pub 2/);
});

test("content to-dos pick the next post in order when nothing has a date", () => {
  const { buildContentPlays } = require("../utils/hq/contentPlays");
  const plays = [{ _id: "li", title: "Posts", active: true, weeklyTarget: 3, targetUnit: "posts", countsFrom: "content", channel: "linkedin", audience: ["director"], done: 0 }];
  const items = ["Post 15: x", "Post 4: y", "Post 10: z"].map((title, k) => ({ _id: `i${k}`, title, status: "ready", playId: "li", channel: "linkedin", audience: [] }));
  const out = buildContentPlays({ items, plays, now: NOW, dayOfWeek: 3, weekKey: "w" });
  assert.deepEqual(out[0].queue.map((i) => i.title), ["Post 4: y", "Post 10: z", "Post 15: x"]);
});

test("content target lists what went out this week, and asks only for what's left", () => {
  const { buildContentPlays } = require("../utils/hq/contentPlays");
  const plays = [{ _id: "li", title: "Posts", active: true, weeklyTarget: 3, targetUnit: "posts", countsFrom: "content", channel: "linkedin", audience: [], done: 1 }];
  const items = [
    { _id: "a", title: "Post 1", status: "published", publishedAt: "2026-10-27T15:00:00Z", playId: "li", channel: "linkedin" },
    { _id: "old", title: "Post 0", status: "published", publishedAt: "2026-10-20T15:00:00Z", playId: "li", channel: "linkedin" },
    ...["Post 2", "Post 3", "Post 4"].map((title, k) => ({ _id: `n${k}`, title, status: "ready", playId: "li", channel: "linkedin" })),
  ];
  const out = buildContentPlays({ items, plays, now: new Date("2026-10-29T15:00:00Z"), dayOfWeek: 3, weekKey: "2026-10-26", weekStart: new Date("2026-10-26T04:00:00Z") });
  assert.deepEqual(out[0].published.map((i) => i.title), ["Post 1"]);
  assert.deepEqual(out[0].queue.map((i) => i.title), ["Post 2", "Post 3"]);
  assert.match(out[0].action, /2 to go/);
});

test("LinkedIn page export: title row above the headers, posts read with their numbers", () => {
  const csv = [
    "Engagement metrics for individual posts. Created date indicates when your post was created. All dates and times are in UTC.",
    "Post title,Post link,Post type,Campaign name,Posted by,Created date,Campaign start date,Campaign end date,Audience,Impressions,Views,Offsite Views,Clicks,Click through rate (CTR),Likes,Comments,Reposts,Follows,Engagement rate,Content Type",
    '"Sunday nights shouldn\'t be spent fixing next week\'s schedule.",https://www.linkedin.com/feed/update/urn:li:activity:7520484666647379969,Organic,,Mannie Charles,10/26/2026,,,All followers,9,,,0,0,1,0,0,,0.11,',
  ].join("\n");
  const { rows } = normalize("linkedin", csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].author, "Mannie Charles");
  assert.equal(rows[0].impressions, 9);
  assert.equal(rows[0].reactions, 1);
  assert.match(rows[0].url, /activity:7520484666647379969/);
});
