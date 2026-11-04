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

test("playbook v6: LinkedIn is content only (no connection play, no connections or messages in the plan)", async () => {
  const seed = require("../utils/hq/playbookSeed");
  assert.ok(!seed.PLAYS.some((p) => p.seedKey === "linkedin-connect"));
  const fresh = JSON.stringify([seed.PLAYS, seed.META, seed.META_V2, seed.V4, seed.MESSAGING]);
  assert.ok(!/connection request|LinkedIn connection|LinkedIn posts and messages|connections and messages/i.test(fresh.replace(/no connection requests/gi, "")), "nothing seeds LinkedIn outreach");

  // Updating an existing playbook at version 5.
  const HqSync = require("../models/hqSyncModel");
  const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
  const HqActivity = require("../models/hqActivityModel");
  const HqContentItem = require("../models/hqContentItemModel");
  const V6 = seed.V6_LINKEDIN;
  const meta = {
    connect: "The channels feed each other. Calls collect leaders' names for email and LinkedIn. Emails, posts and videos send people to the calculators.",
    tierRules: [{ tier: "Tier 1 (Close First)", plays: "Everything: front-desk call, leadership email the same week, LinkedIn connection with the DON or administrator, Monday email turned on at setup." }],
    week: [{ day: "Thursday", a: "15 front-desk calls", b: V6.oldThursday }],
    buyers: [{ key: "director", how: "Cold email from your own inbox, the follow-up call, LinkedIn posts and messages, the leaders' Klaviyo email." }],
    channels: [{ key: "linkedin", name: "LinkedIn", why: V6.oldWhy }, { key: "calls", name: "Calls", why: "keep" }],
  };
  const saved = {};
  const orig = { syncFind: HqSync.findOne, syncUpd: HqSync.updateOne, playFind: HqPlaybookPlay.findOne, playDel: HqPlaybookPlay.deleteOne, playUpd: HqPlaybookPlay.updateOne, actUpd: HqActivity.updateMany, itemUpd: HqContentItem.updateMany };
  const lean = (v) => ({ lean: async () => v, select: () => ({ lean: async () => v }) });
  HqSync.findOne = (q) => lean(q.key === "playbook-seed" ? { data: { version: 5 } } : { data: meta });
  HqSync.updateOne = async (q, u) => {
    if (q.key === "playbook") Object.assign(saved, u.$set);
    if (u.$set?.["data.channels"]) meta.channels = u.$set["data.channels"]; // later versions read what earlier ones saved
    return {};
  };
  const deleted = [];
  const unlinked = [];
  let postsSteps = null;
  HqPlaybookPlay.findOne = (q) => lean(q.seedKey === "linkedin-connect" ? { _id: "c1" } : q.seedKey === "linkedin-posts" ? { _id: "p1", steps: V6.oldPostSteps } : null);
  HqPlaybookPlay.deleteOne = async (q) => deleted.push(q._id);
  HqPlaybookPlay.updateOne = async (q, u) => { if (q._id === "p1") postsSteps = u.$set.steps; };
  HqActivity.updateMany = async (q) => unlinked.push(["activity", q.playId]);
  HqContentItem.updateMany = async (q) => unlinked.push(["content", q.playId]);
  const origFOU = HqPlaybookPlay.findOneAndUpdate;
  const origItemOne = HqContentItem.updateOne;
  HqPlaybookPlay.findOneAndUpdate = async () => ({ _id: "fp1" }); // v7 runs too
  HqContentItem.updateOne = async () => ({});
  try {
    await require("../controllers/hqPlaybookController").ensureSeeded();
  } finally {
    Object.assign(HqSync, { findOne: orig.syncFind, updateOne: orig.syncUpd });
    Object.assign(HqPlaybookPlay, { findOne: orig.playFind, deleteOne: orig.playDel, updateOne: orig.playUpd });
    HqActivity.updateMany = orig.actUpd;
    HqContentItem.updateMany = orig.itemUpd;
    HqPlaybookPlay.findOneAndUpdate = origFOU;
    HqContentItem.updateOne = origItemOne;
  }
  assert.deepEqual(deleted, ["c1"]);
  assert.deepEqual(unlinked.sort(), [["activity", "c1"], ["content", "c1"]]);
  assert.ok(postsSteps.some((s) => /no connection requests/.test(s)));
  assert.equal(saved["data.connect"], "The channels feed each other. Calls collect leaders' names for email. Emails, posts and videos send people to the calculators.");
  assert.ok(!saved["data.tierRules"][0].plays.includes("LinkedIn"));
  assert.equal(saved["data.week"][0].b, V6.thursday);
  assert.ok(saved["data.buyers"][0].how.includes("LinkedIn posts, the leaders'"));
  assert.equal(saved["data.channels"][0].why, V6.why);
  assert.equal(saved["data.channels"][1].why, "keep");
});

test("playbook v7: a WiserShifts Facebook Page play next to the groups one", async () => {
  const seed = require("../utils/hq/playbookSeed");
  const def = seed.PLAYS.find((p) => p.seedKey === "facebook-page");
  assert.ok(def && def.channel === "facebook" && def.countsFrom === "content" && def.weeklyTarget === 3);
  assert.equal(seed.CONTENT_V2.filter((c) => c.play === "facebook-page").length, seed.FB_PAGE_IDEAS.length);

  const HqSync = require("../models/hqSyncModel");
  const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
  const HqContentItem = require("../models/hqContentItemModel");
  const channels = [{ key: "facebook", name: seed.FB_CHANNEL.oldName, why: seed.FB_CHANNEL.oldWhy }, { key: "youtube", name: "YouTube", why: "keep" }];
  const saved = {};
  const upserts = [];
  const items = [];
  const orig = { syncFind: HqSync.findOne, syncUpd: HqSync.updateOne, playFind: HqPlaybookPlay.findOne, playFOU: HqPlaybookPlay.findOneAndUpdate, itemUpd: HqContentItem.updateOne };
  const lean = (v) => ({ lean: async () => v, select: () => ({ lean: async () => v }) });
  HqSync.findOne = (q) => lean(q.key === "playbook-seed" ? { data: { version: 6 } } : { data: { channels } });
  HqSync.updateOne = async (q, u) => { if (q.key === "playbook") Object.assign(saved, u.$set); return {}; };
  HqPlaybookPlay.findOne = (q) => lean(q.seedKey === "facebook-groups" ? { _id: "g1", order: 9 } : null);
  HqPlaybookPlay.findOneAndUpdate = async (q, u) => { upserts.push([q.seedKey, u.$setOnInsert]); return { _id: "fp1" }; };
  const origPlayUpd = HqPlaybookPlay.updateOne;
  HqPlaybookPlay.updateOne = async () => ({}); // v8 runs too
  HqContentItem.updateOne = async (q, u) => { items.push(u.$setOnInsert); return {}; };
  try {
    await require("../controllers/hqPlaybookController").ensureSeeded();
  } finally {
    Object.assign(HqSync, { findOne: orig.syncFind, updateOne: orig.syncUpd });
    Object.assign(HqPlaybookPlay, { findOne: orig.playFind, findOneAndUpdate: orig.playFOU });
    HqPlaybookPlay.updateOne = origPlayUpd;
    HqContentItem.updateOne = orig.itemUpd;
  }
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][0], "facebook-page");
  assert.equal(upserts[0][1].order, 9.5);
  assert.equal(items.length, seed.FB_PAGE_IDEAS.length);
  assert.ok(items.every((i) => i.playId === "fp1" && i.channel === "facebook" && !("play" in i)));
  assert.equal(saved["data.channels"][0].name, seed.FB_CHANNEL.name);
  assert.equal(saved["data.channels"][0].why, seed.FB_CHANNEL.why);
  assert.equal(saved["data.channels"][1].why, "keep");
});

test("week plan: calls go to specific facilities, best first, spread Monday to Friday", () => {
  const plan = require("../utils/hq/weekPlan");
  const now = new Date("2026-11-03T15:00:00Z");
  const play = { _id: "p1", active: true, channel: "calls", audience: ["scheduler"], weeklyTarget: 10, countsFrom: "activities" };
  const facilities = [
    { _id: "f1", name: "Tier 2", tier: 2, frontDeskPhone: "555-1" },
    { _id: "f2", name: "Tier 1", tier: 1, frontDeskPhone: "555-2" },
    { _id: "f3", name: "No phone", tier: 1 },
    { _id: "f4", name: "Customer", tier: 1, frontDeskPhone: "555-4", tenantId: "t1" },
    { _id: "f5", name: "Called last week", tier: 1, frontDeskPhone: "555-5" },
    { _id: "f6", name: "Call-back due", tier: 3, frontDeskPhone: "555-6", nextDate: new Date("2026-11-04") },
    { _id: "f7", name: "Not interested", tier: 1, frontDeskPhone: "555-7", stage: "Not interested" },
  ];
  const lastTouch = new Map([["f5", new Date("2026-10-28")]]);
  const out = plan.todosFor(play, { facilities, lastTouch, now, weekEnd: new Date("2026-11-09T05:00:00Z") });
  assert.deepEqual(out.map((t) => t.title), ["Call-back due", "Tier 1", "Tier 2"]);
  assert.equal(out[0].phone, "555-6");
  assert.deepEqual(out.map((t) => t.day), [0, 0, 1]); // 10 a week = 2 a day
  // A refill only adds what's missing, and never repeats someone.
  const more = plan.todosFor(play, { facilities, lastTouch, now, have: out.map((t) => ({ refId: t.refId })) });
  assert.equal(more.length, 0);
  assert.equal(plan.dayFor(59, 60), 4);
});

test("week plan: leadership emails go to the leaders, content plays to the next pieces", () => {
  const plan = require("../utils/hq/weekPlan");
  const now = new Date("2026-11-03T15:00:00Z");
  const email = { _id: "e1", active: true, channel: "email", audience: ["director"], weeklyTarget: 2, countsFrom: "activities" };
  const contacts = [
    { _id: "c1", name: "Pat", title: "DON", role: "don", email: "pat@x.org", facilityId: "f1" },
    { _id: "c2", name: "Sam", role: "scheduler", email: "sam@x.org" },
    { _id: "c3", name: "Lee", role: "administrator", email: "", facilityId: "f1" },
    { _id: "c4", name: "Ana", role: "executive_director", email: "ana@y.org" },
  ];
  const out = plan.todosFor(email, { contacts, facilities: [{ _id: "f1", name: "Oak Manor", tier: 1 }], now });
  assert.deepEqual(out.map((t) => t.refId), ["c1", "c4"]);
  assert.equal(out[0].detail, "Oak Manor");
  assert.equal(out[0].email, "pat@x.org");

  const posts = { _id: "lp", active: true, channel: "facebook", audience: ["scheduler"], weeklyTarget: 3, countsFrom: "content" };
  const weekStart = new Date("2026-11-02T05:00:00Z");
  const items = [
    { _id: "i1", playId: "lp", title: "Idea A", status: "idea" },
    { _id: "i2", playId: "lp", title: "Ready B", status: "ready" },
    { _id: "i3", playId: "lp", title: "Out Monday", status: "published", publishedAt: new Date("2026-11-02T17:00:00Z") },
    { _id: "i4", playId: "lp", title: "Idea C", status: "idea" },
    { _id: "i5", playId: "other", title: "Not this play", status: "ready" },
  ];
  const c = plan.todosFor(posts, { items, now, weekStart });
  assert.deepEqual(c.map((t) => t.title), ["Out Monday", "Ready B", "Idea A"]);
  assert.deepEqual(plan.moreFor(posts, { items, have: c }).map((t) => t.title), ["Idea C"]);

  // Every two weeks: not on the list when one went out last week.
  const blog = { _id: "b", active: true, channel: "blog", weeklyTarget: 0.5, countsFrom: "content" };
  const blogItems = [
    { _id: "b1", playId: "b", title: "Last", status: "published", publishedAt: new Date("2026-10-28T12:00:00Z") },
    { _id: "b2", playId: "b", title: "Next", status: "idea" },
  ];
  assert.equal(plan.todosFor(blog, { items: blogItems, now, weekStart }).length, 0);
  assert.equal(plan.todosFor(blog, { items: blogItems, now: new Date("2026-11-12T12:00:00Z"), weekStart: new Date("2026-11-09T05:00:00Z") }).length, 1);
  // Plays without a list: leads, signups, nothing to count.
  assert.equal(plan.listKind({ active: true, weeklyTarget: 1, countsFrom: "leads", channel: "newsletter" }), null);
});

test("a date picked in a form counts in the right week (Monday posts aren't last week's)", () => {
  const { dayToDate, lastWeeks } = require("../utils/hq/weeks");
  const now = new Date("2026-11-03T15:00:00Z"); // Tuesday, New York
  const week = lastWeeks(1, now)[0];
  const monday = dayToDate("2026-11-02", now);
  assert.ok(monday >= week.start && monday < week.end, "Monday is this week");
  assert.equal(dayToDate("2026-11-03", now).getTime(), now.getTime(), "today means now");
  assert.equal(dayToDate("", now), null);
});

test("week checklist: ticking a call logs it with the play, unticking removes it", async () => {
  const mongoose = require("mongoose");
  const HqWeekPlan = require("../models/hqWeekPlanModel");
  const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
  const HqActivity = require("../models/hqActivityModel");
  const HqContentItem = require("../models/hqContentItemModel");
  const HqFacility = require("../models/hqFacilityModel");
  const HqContact = require("../models/hqContactModel");
  const HqSync = require("../models/hqSyncModel");
  const pb = require("../controllers/hqPlaybookController");
  const hq = require("../controllers/hqController");
  const playId = new mongoose.Types.ObjectId();
  const fid = new mongoose.Types.ObjectId();
  const play = { _id: playId, active: true, title: "Front desk calls", channel: "calls", audience: ["scheduler"], weeklyTarget: 5, targetUnit: "calls", countsFrom: "activities" };
  const q = (v) => { const o = { sort: () => o, select: () => o, lean: async () => v, then: (r, j) => Promise.resolve(v).then(r, j) }; return o; };
  let doc = null;
  const activities = [];
  const facilityUpdates = [];
  const saved = { stubs: [] };
  const stub = (obj, name, fn) => { saved.stubs.push([obj, name, obj[name]]); obj[name] = fn; };
  stub(HqSync, "findOne", () => q({ data: { version: 99 } }));
  stub(HqPlaybookPlay, "find", () => q([play]));
  stub(HqPlaybookPlay, "findById", () => q(play));
  stub(HqContentItem, "find", () => q([]));
  stub(HqFacility, "find", () => q([{ _id: fid, name: "Oak Manor", tier: 1, frontDeskPhone: "555-0100" }]));
  stub(HqFacility, "findById", () => q({ lastCallDate: null }));
  stub(HqFacility, "updateOne", async (f, u) => facilityUpdates.push(u));
  stub(HqContact, "find", () => q([]));
  stub(HqActivity, "aggregate", async () => []);
  stub(require("../models/hqFbGroupModel"), "find", () => q([]));
  stub(require("../models/hqFbPersonModel"), "find", () => q([]));
  stub(HqActivity, "find", (f) => q(f._id ? activities.filter((a) => f._id.$in.map(String).includes(String(a._id))) : activities.filter((a) => String(a.playId) === String(playId))));
  stub(HqActivity, "create", async (a) => { const x = { ...a, _id: new mongoose.Types.ObjectId() }; activities.push(x); return x; });
  stub(HqActivity, "findByIdAndDelete", (id) => q(activities.splice(activities.findIndex((a) => String(a._id) === String(id)), 1)[0]));
  stub(HqWeekPlan, "findOne", async () => doc);
  stub(HqWeekPlan.prototype, "save", async function save() { doc = this; return this; });
  stub(pb, "scoreboard", async () => [{ playId: String(playId), weeks: [activities.length] }]);
  const call = async (fn, req) => { let out; const res = { status: () => res, json: (b) => { out = b; return res; } }; await fn({ hqUser: { name: "Tolu" }, body: {}, params: {}, ...req }, res, (e) => { throw e; }); return out; };
  try {
    const week = await call(require("../controllers/hqWeekController").getWeek, {});
    const p = week.plays[0];
    assert.equal(p.todos.length, 1);
    assert.equal(p.todos[0].title, "Oak Manor");
    assert.equal(p.todos[0].done, false);
    const ticked = await call(require("../controllers/hqWeekController").check, { params: { itemId: p.todos[0]._id }, body: { done: true } });
    assert.equal(ticked.plays[0].todos[0].done, true);
    assert.equal(ticked.plays[0].count, 1);
    assert.equal(activities.length, 1);
    assert.equal(activities[0].kind, "call");
    assert.equal(String(activities[0].playId), String(playId));
    assert.equal(String(activities[0].facilityId), String(fid));
    assert.equal(facilityUpdates[0].$inc.attempts, 1);
    const unticked = await call(require("../controllers/hqWeekController").check, { params: { itemId: p.todos[0]._id }, body: { done: false } });
    assert.equal(unticked.plays[0].todos[0].done, false);
    assert.equal(unticked.plays[0].count, 0);
    assert.equal(activities.length, 0);
    assert.equal(facilityUpdates[1].$inc.attempts, -1);
    // Your own to-do.
    const withTask = await call(require("../controllers/hqWeekController").addTask, { body: { title: "Ask Dana for a referral" } });
    assert.equal(withTask.tasks[0].title, "Ask Dana for a referral");
    const removed = await call(require("../controllers/hqWeekController").removeItem, { params: { itemId: withTask.tasks[0]._id } });
    assert.equal(removed.tasks.length, 0);
  } finally {
    for (const [obj, name, orig] of saved.stubs.reverse()) obj[name] = orig;
    void hq;
  }
});

test("facebook: each group moves one step at a time (join, admin, offer, then answers)", () => {
  const fb = require("../utils/hq/facebook");
  const now = new Date("2026-11-03T15:00:00Z");
  const g = { _id: "g1", name: "CNA Schedulers", status: "found", promo: "ask" };
  assert.equal(fb.nextGroupStep(g, now).action, "join");
  assert.equal(fb.nextGroupStep({ ...g, status: "requested" }, now).action, "joined");
  assert.equal(fb.nextGroupStep({ ...g, status: "joined" }, now).action, "admin", "admin message before any offer");
  assert.equal(fb.nextGroupStep({ ...g, status: "asked", askedAt: new Date("2026-11-01") }, now).action, "answer", "keep answering while waiting");
  assert.equal(fb.nextGroupStep({ ...g, status: "asked", askedAt: new Date("2026-10-27") }, now).action, "admin_followup", "one nudge after 5 days");
  assert.equal(fb.nextGroupStep({ ...g, status: "asked", askedAt: new Date("2026-10-27"), adminFollowedUpAt: new Date("2026-11-01") }, now).action, "answer");
  assert.equal(fb.nextGroupStep({ ...g, status: "approved" }, now).action, "offer");
  assert.equal(fb.nextGroupStep({ ...g, status: "approved", offerAt: now }, now).action, "answer");
  assert.equal(fb.nextGroupStep({ ...g, status: "joined", promo: "allowed" }, now).action, "offer", "no need to ask when promotion is allowed");
  assert.equal(fb.nextGroupStep({ ...g, status: "joined", promo: "none" }, now).action, "answer");
  assert.equal(fb.nextGroupStep({ ...g, status: "left" }, now), null);
  assert.deepEqual(fb.groupChange("admin", now), { status: "asked", askedAt: now });

  const p = { _id: "p1", name: "Tina", status: "to_message", said: "WEEK" };
  assert.equal(fb.nextPersonStep(p, now).action, "message");
  assert.equal(fb.nextPersonStep({ ...p, status: "messaged", messagedAt: new Date("2026-11-02") }, now), null, "too soon to follow up");
  assert.equal(fb.nextPersonStep({ ...p, status: "messaged", messagedAt: new Date("2026-10-30") }, now).action, "followup");
  assert.equal(fb.nextPersonStep({ ...p, status: "replied" }, now).action, "call_booked");
  assert.equal(fb.nextPersonStep({ ...p, status: "signed_up" }, now), null);
});

test("week plan: Facebook groups get their next step, everyone to message is added", () => {
  const plan = require("../utils/hq/weekPlan");
  const now = new Date("2026-11-03T15:00:00Z");
  const play = { _id: "fbg", active: true, channel: "facebook", audience: ["scheduler"], weeklyTarget: 2, countsFrom: "activities" };
  assert.equal(plan.listKind(play), "facebook");
  const groups = [
    { _id: "a", name: "Answers only", status: "joined", promo: "none", priority: 1, lastAnswerAt: new Date("2026-10-20") },
    { _id: "b", name: "Needs admin", status: "joined", promo: "ask", priority: 2 },
    { _id: "c", name: "To join", status: "found", priority: 1, members: 9000 },
    { _id: "d", name: "Gone", status: "left" },
  ];
  const people = [
    { _id: "p1", name: "Tina", status: "to_message", groupId: "b" },
    { _id: "p2", name: "Rae", status: "to_message" },
    { _id: "p3", name: "Done", status: "signed_up" },
  ];
  const out = plan.todosFor(play, { groups, people, now });
  // Steps that move a group forward first (join, admin), capped at the target; people aren't capped.
  assert.deepEqual(out.map((t) => [t.kind, t.refId, t.action]), [["fbgroup", "c", "join"], ["fbgroup", "b", "admin"], ["fbperson", "p1", "message"], ["fbperson", "p2", "message"]]);
  assert.equal(out[2].title, "Message Tina (from Needs admin)");
  // Once the admin was messaged (logged anywhere), refills don't repeat it; the group still counts against the cap.
  const after = plan.todosFor(play, { groups: groups.map((g) => (g._id === "b" ? { ...g, status: "asked", askedAt: now } : g)), people, now, have: out });
  assert.deepEqual(after, []);
  // More: answers in other groups.
  assert.deepEqual(plan.moreFor(play, { groups, now, have: out }).map((t) => t.refId), ["a"]);
});

test("facebook: logging an action moves the group forward and counts; undo puts it back", async () => {
  const mongoose = require("mongoose");
  const HqFbGroup = require("../models/hqFbGroupModel");
  const HqActivity = require("../models/hqActivityModel");
  const HqPlaybookPlay = require("../models/hqPlaybookPlayModel");
  const fbc = require("../controllers/hqFacebookController");
  const gid = new mongoose.Types.ObjectId();
  const playId = new mongoose.Types.ObjectId();
  let group = { _id: gid, name: "CNA Schedulers", status: "joined", askedAt: null };
  const acts = [];
  const orig = [HqFbGroup.findById, HqFbGroup.updateOne, HqActivity.create, HqActivity.findById, HqActivity.deleteOne, HqPlaybookPlay.findOne];
  const lean = (v) => ({ lean: async () => v, select: () => ({ lean: async () => v }) });
  HqFbGroup.findById = () => lean(group);
  HqFbGroup.updateOne = async (q, u) => { group = { ...group, ...u.$set }; };
  HqActivity.create = async (a) => { const x = { ...a, _id: new mongoose.Types.ObjectId() }; acts.push(x); return x; };
  HqActivity.findById = (id) => lean(acts.find((a) => String(a._id) === String(id)));
  HqActivity.deleteOne = async (q) => acts.splice(acts.findIndex((a) => String(a._id) === String(q._id)), 1);
  HqPlaybookPlay.findOne = () => lean({ _id: playId });
  try {
    const r = await fbc.logAction("group", gid, "admin", { notes: "Asked Jen" });
    assert.equal(group.status, "asked");
    assert.ok(group.askedAt);
    assert.equal(acts.length, 1);
    assert.equal(acts[0].kind, "facebook");
    assert.equal(acts[0].fbAction, "admin");
    assert.equal(String(acts[0].playId), String(playId), "counts toward the Facebook groups play");
    assert.equal((await fbc.logAction("group", gid, "nonsense")).error, "Which action?");
    assert.ok(await fbc.undoAction(r.activity._id));
    assert.equal(group.status, "joined");
    assert.equal(group.askedAt, null);
    assert.equal(acts.length, 0);
  } finally {
    [HqFbGroup.findById, HqFbGroup.updateOne, HqActivity.create, HqActivity.findById, HqActivity.deleteOne, HqPlaybookPlay.findOne] = orig;
  }
});

test("week plan: a short list says why, and content is spread over the weekdays", () => {
  const plan = require("../utils/hq/weekPlan");
  const now = new Date("2026-11-04T15:00:00Z");
  const calls = { _id: "p", active: true, channel: "calls", audience: ["scheduler"], weeklyTarget: 60, countsFrom: "activities" };
  const facilities = [
    { _id: "a", name: "No phone" },
    { _id: "b", name: "No phone 2" },
    { _id: "c", name: "Customer", frontDeskPhone: "1", tenantId: "t" },
    { _id: "d", name: "Called Monday", frontDeskPhone: "1" },
  ];
  const why = plan.whyShort(calls, { facilities, lastTouch: new Map([["d", new Date("2026-11-02")]]), now });
  assert.equal(why.total, 4);
  assert.deepEqual(why.reasons, [[1, "are customers or closed"], [2, "have no front-desk phone"], [1, "were called in the last 14 days"]]);
  assert.equal(why.page, "facilities");

  const emails = { _id: "e", active: true, channel: "email", audience: ["director"], weeklyTarget: 35, countsFrom: "activities" };
  const w2 = plan.whyShort(emails, { contacts: [{ _id: "x", role: "don" }, { _id: "y", role: "don", email: "y@z.org" }, { _id: "s", role: "scheduler" }], now });
  assert.equal(w2.total, 2, "only the leaders the play is for");
  assert.deepEqual(w2.reasons, [[1, "have no email"]]);
  assert.match(w2.fix, /DONs, EDs and administrators/);

  assert.deepEqual([0, 1, 2].map((i) => plan.contentDay(i, 3)), [0, 2, 4]);
  assert.equal(plan.contentDay(0, 1), 1);
  assert.equal(plan.contentDay(6, 7), 1);
});

test("facebook: links typed without https:// still open Facebook; 'asked today' reads right", () => {
  const fb = require("../utils/hq/facebook");
  assert.equal(fb.fullUrl("facebook.com/groups/alconnect"), "https://facebook.com/groups/alconnect");
  assert.equal(fb.fullUrl("www.facebook.com/groups/1"), "https://www.facebook.com/groups/1");
  assert.equal(fb.fullUrl("https://www.facebook.com/groups/1"), "https://www.facebook.com/groups/1");
  assert.equal(fb.fullUrl(""), "");
  const now = new Date("2026-11-04T18:00:00Z");
  assert.match(fb.nextGroupStep({ name: "G", status: "requested", requestedAt: new Date("2026-11-04T15:00:00Z") }, now).why, /^Asked today\./);
  assert.equal(fb.groupTodos([{ _id: "g", name: "G", status: "found", url: "facebook.com/groups/g" }], { n: 1, now })[0].url, "https://facebook.com/groups/g");
});
