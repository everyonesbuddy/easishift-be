const test = require("node:test");
const assert = require("node:assert/strict");
const gov = require("../utils/hq/gov");

const opp = (over = {}) => ({
  noticeId: "abc123",
  title: "Nurse Scheduling Software Subscription",
  solicitationNumber: "36C24726Q0001",
  fullParentPathName: "VETERANS AFFAIRS, DEPARTMENT OF.VETERANS AFFAIRS, DEPARTMENT OF.247-NETWORK CONTRACT OFFICE 7 (36C247)",
  postedDate: "2026-11-02",
  type: "Combined Synopsis/Solicitation",
  responseDeadLine: "2026-11-20T15:00:00-05:00",
  naicsCode: "513210",
  active: "Yes",
  uiLink: "https://sam.gov/opp/abc123/view",
  placeOfPerformance: { state: { code: "GA", name: "Georgia" } },
  ...over,
});

test("gov feed: keeps listings about scheduling people, drops the rest", () => {
  const l = gov.fromSam(opp(), "Software publishers (513210)");
  assert.equal(l.noticeId, "abc123");
  assert.equal(l.agency, "VETERANS AFFAIRS, DEPARTMENT OF · 247-NETWORK CONTRACT OFFICE 7 (36C247)");
  assert.equal(l.state, "GA");
  assert.equal(l.dueAt.toISOString(), "2026-11-20T20:00:00.000Z");
  for (const t of ["Staff Scheduling System", "Workforce Management Solution", "Time and Attendance / Timekeeping", "QGenda renewal", "Nurse staffing software"]) assert.ok(gov.fromSam(opp({ title: t })), t);
  for (const t of ["Aircraft maintenance scheduling support", "Janitorial services", "Scheduling of bus routes"]) assert.equal(gov.fromSam(opp({ title: t })), null, t);
  assert.equal(gov.fromSam(opp({ type: "Award Notice" })), null, "awards aren't something you can bid on");
  assert.equal(gov.fromSam(opp({ active: "No" })), null);
});

test("gov feed: the date window starts a day before the last pull, or 60 days back", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  assert.deepEqual(gov.window(null, now), { postedFrom: "10/11/2026", postedTo: "11/10/2026" });
  assert.deepEqual(gov.window(new Date("2026-11-09T11:35:00Z"), now), { postedFrom: "11/08/2026", postedTo: "11/10/2026" });
  assert.equal(gov.window(new Date("2024-01-01"), now).postedFrom, "11/11/2025", "never more than a year");
});

test("gov deadlines: questions, responses, bid-or-pass, and passed due dates", () => {
  const now = new Date("2026-11-10T15:00:00Z");
  const d = (days) => new Date(now.getTime() + days * 86400000);
  const todos = gov.deadlineTodos(
    [
      { _id: "a", title: "A", status: "bidding", dueAt: d(10), questionsDueAt: d(3), checklist: [{ text: "x", done: true }, { text: "y", done: false }] },
      { _id: "b", title: "B", status: "reviewing", dueAt: d(5) },
      { _id: "c", title: "C", status: "bidding", dueAt: d(-1) },
      { _id: "d", title: "D", status: "bidding", dueAt: d(30) },
      { _id: "e", title: "E", status: "submitted", dueAt: d(2) },
      { _id: "f", title: "F", status: "passed", dueAt: d(2) },
    ],
    { now, tz: "America/New_York" },
  );
  assert.deepEqual(todos.map((t) => `${t.refId}:${t.kind}`), ["c:overdue", "a:questions", "b:decide", "a:due"]);
  assert.match(todos.find((t) => t.kind === "due").detail, /1 of 2 steps/);
});

test("SAM.gov pull: saves new matches as New, keeps what you set on old ones", async () => {
  process.env.SAM_GOV_API_KEY = "test-key";
  const HqGovListing = require("../models/hqGovListingModel");
  const HqSync = require("../models/hqSyncModel");
  const sam = require("../utils/hq/samGov");
  const orig = [HqGovListing.updateOne, HqSync.findOne, HqSync.updateOne];
  const writes = [];
  let synced = null;
  HqGovListing.updateOne = async (f, u) => (writes.push({ f, u }), { upsertedCount: f.noticeId === "abc123" ? 1 : 0 });
  HqSync.findOne = () => ({ lean: async () => ({ data: { lastFetchAt: new Date("2026-11-09T11:35:00Z") } }) });
  HqSync.updateOne = async (f, u) => (synced = u);
  const calls = [];
  const get = async (url, { params }) => {
    calls.push(params);
    const data = params.ncode === "513210" ? [opp(), opp({ noticeId: "old1", title: "Staff scheduling system" }), opp({ noticeId: "x", title: "Janitorial" })] : params.title === "scheduling" ? [opp()] : [];
    return { data: { totalRecords: data.length, opportunitiesData: data } };
  };
  try {
    const r = await sam.fetchNew({ now: new Date("2026-11-10T11:35:00Z"), get });
    assert.deepEqual(r, { ok: true, found: 2, added: 1, failed: [] });
    assert.equal(calls.length, gov.SEARCHES.length, "one request per search");
    assert.equal(calls[0].postedFrom, "11/08/2026");
    const w = writes.find((x) => x.f.noticeId === "abc123").u;
    assert.equal(w.$setOnInsert.status, "new");
    assert.equal(w.$set.status, undefined, "your status is never overwritten");
    assert.ok(!Object.keys(w.$set).some((k) => k in w.$setOnInsert), "no field in both $set and $setOnInsert");
    assert.equal(synced.$set.data.lastAdded, 1);
  } finally {
    [HqGovListing.updateOne, HqSync.findOne, HqSync.updateOne] = orig;
    delete process.env.SAM_GOV_API_KEY;
  }
});

test("SAM.gov pull: a refused key is reported in plain words, without the key", async () => {
  process.env.SAM_GOV_API_KEY = "secret-key";
  const HqSync = require("../models/hqSyncModel");
  const sam = require("../utils/hq/samGov");
  const orig = [HqSync.findOne, HqSync.updateOne];
  HqSync.findOne = () => ({ lean: async () => null });
  HqSync.updateOne = async () => ({});
  try {
    const r = await sam.fetchNew({ get: async () => Promise.reject(Object.assign(new Error("x"), { response: { status: 403 } })) });
    assert.equal(r.ok, false);
    assert.match(r.error, /refused the API key/);
    assert.doesNotMatch(r.error, /secret-key/);
  } finally {
    [HqSync.findOne, HqSync.updateOne] = orig;
    delete process.env.SAM_GOV_API_KEY;
  }
});

test("SAM.gov pull: a slow search is skipped, the rest are saved, and the window waits for it", async () => {
  process.env.SAM_GOV_API_KEY = "test-key";
  const HqGovListing = require("../models/hqGovListingModel");
  const HqSync = require("../models/hqSyncModel");
  const sam = require("../utils/hq/samGov");
  const orig = [HqGovListing.updateOne, HqSync.findOne, HqSync.updateOne];
  const lastFetchAt = new Date("2026-11-09T11:35:00Z");
  let synced = null;
  HqGovListing.updateOne = async () => ({ upsertedCount: 1 });
  HqSync.findOne = () => ({ lean: async () => ({ data: { lastFetchAt } }) });
  HqSync.updateOne = async (f, u) => (synced = u);
  let staffingTries = 0;
  const get = async (url, { params }) => {
    if (params.title === "staffing") {
      staffingTries += 1;
      throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
    }
    const data = params.title === "scheduling" ? [opp()] : [];
    return { data: { totalRecords: data.length, opportunitiesData: data } };
  };
  try {
    const r = await sam.fetchNew({ now: new Date("2026-11-10T11:35:00Z"), get });
    assert.equal(r.ok, true);
    assert.equal(r.added, 1, "the other searches still count");
    assert.equal(staffingTries, 2, "a timeout gets one more try");
    assert.deepEqual(r.failed.map((f) => f.label), ['"staffing" in the title']);
    assert.match(synced.$set.data.lastError, /1 of 5 searches didn't finish .*too slow/);
    assert.equal(synced.$set.data.lastFetchAt, lastFetchAt, "the window doesn't move, so the skipped search is covered next time");
  } finally {
    [HqGovListing.updateOne, HqSync.findOne, HqSync.updateOne] = orig;
    delete process.env.SAM_GOV_API_KEY;
  }
});
