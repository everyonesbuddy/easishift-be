const test = require("node:test");
const assert = require("node:assert/strict");
const cs = require("../utils/hq/success");

const now = new Date("2026-11-12T15:00:00Z"); // a Thursday
const daysAgo = (n) => new Date(now.getTime() - n * cs.DAY);
const good = {
  subscriptionStatus: "active",
  staff: 20,
  staffWithPhone: 19,
  optedIn: 15,
  smsPlan: true,
  thisWeekPublished: true,
  nextWeekPublished: true,
  weekday: 4,
  managersOptedIn: 2,
  lastManagerSeenAt: daysAgo(1),
  staffOpened14: 12,
  calloutsFilled30: 2,
};

test("customer health: green when it's all working", () => {
  assert.deepEqual(cs.health(good, { now, startedAt: daysAgo(40) }), { level: "green", reasons: [] });
});

test("customer health: warning signs turn it yellow early", () => {
  const h = cs.health({ ...good, nextWeekPublished: false, optedIn: 4, lastManagerSeenAt: daysAgo(6) }, { now, startedAt: daysAgo(40) });
  assert.equal(h.level, "yellow");
  assert.deepEqual(h.reasons, ["Next week isn't published yet", "No manager has logged in for 6 days", "Only 4 of 19 staff said yes to texts"]);
  // Next week not published only counts from Thursday.
  assert.equal(cs.health({ ...good, nextWeekPublished: false, weekday: 2 }, { now, startedAt: daysAgo(40) }).level, "green");
});

test("customer health: red for a failed payment, an unpublished week or managers gone quiet", () => {
  assert.equal(cs.health({ ...good, subscriptionStatus: "past_due" }, { now, startedAt: daysAgo(40) }).reasons[0], "Their payment failed");
  assert.equal(cs.health({ ...good, thisWeekPublished: false }, { now, startedAt: daysAgo(40) }).level, "red");
  assert.equal(cs.health({ ...good, lastManagerSeenAt: daysAgo(12) }, { now, startedAt: daysAgo(40) }).reasons[0], "No manager has logged in for 12 days");
  // In the first week, not being set up yet is only yellow.
  const fresh = cs.health({ ...good, staff: 0, staffWithPhone: 0, optedIn: 0, thisWeekPublished: false, lastManagerSeenAt: null }, { now, startedAt: daysAgo(3) });
  assert.equal(fresh.level, "yellow");
});

test("checklist: data ticks items by itself; monthly and at-risk items start fresh", () => {
  const items = cs.checklist({ stage: "onboarding", done: { "onboarding:kickoff": daysAgo(5) } }, { ...good, calloutsFilled30: 0 }, now);
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(by["onboarding:kickoff"].done, true, "ticked by hand");
  assert.equal(by["onboarding:phones"].done, true, "19 of 20 have phones");
  assert.equal(by["onboarding:phones"].auto, true);
  assert.equal(by["onboarding:callout"].done, false, "no call-out filled yet");
  const steady = cs.checklist({ stage: "steady", done: {} }, good, now);
  assert.equal(steady[0].key, "steady:number:2026-11");
  const risk = cs.checklist({ stage: "at_risk", stageAt: daysAgo(1), done: {} }, good, now);
  assert.equal(risk[0].key, "at_risk:call:2026-11-11");
});

test("check-in cadence: at risk every 3 days, weekly for 90 days, then every two weeks", () => {
  assert.equal(cs.cadenceDays("at_risk", daysAgo(200), now), 3);
  assert.equal(cs.cadenceDays("onboarding", daysAgo(5), now), 7);
  assert.equal(cs.cadenceDays("steady", daysAgo(60), now), 7);
  assert.equal(cs.cadenceDays("steady", daysAgo(120), now), 14);
  assert.equal(cs.cadenceDays("churned", daysAgo(120), now), null);
  assert.equal(cs.nextBusinessDay(new Date("2026-11-13T15:00:00Z")).toISOString().slice(0, 10), "2026-11-16", "Friday → Monday");
});

test("This week: red customers first, then overdue and due check-ins", () => {
  const list = cs.todos(
    [
      { _id: "a", name: "Silver Comet", stage: "onboarding", nextCheckInAt: new Date(now.getTime() + 3600e3), health: { level: "yellow", reasons: ["Only 4 of 19 staff said yes to texts"] } },
      { _id: "b", name: "Maple", stage: "steady", nextCheckInAt: daysAgo(2), health: { level: "green", reasons: [] } },
      { _id: "c", name: "Oak", stage: "steady", nextCheckInAt: daysAgo(-5), health: { level: "red", reasons: ["Their payment failed"] } },
      { _id: "d", name: "Gone", stage: "churned", nextCheckInAt: daysAgo(1), health: { level: "red", reasons: ["x"] } },
      { _id: "e", name: "Later", stage: "steady", nextCheckInAt: daysAgo(-6), health: { level: "green", reasons: [] } },
    ],
    { now, tz: "America/New_York" },
  );
  assert.deepEqual(list.map((t) => `${t.refId}:${t.kind}`), ["c:red", "b:late", "a:checkin"]);
  assert.match(list[2].detail, /Ask about: only 4 of 19/);
});
