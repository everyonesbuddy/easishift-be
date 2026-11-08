const test = require("node:test");
const assert = require("node:assert/strict");
const { toGsm, segments } = require("../utils/smsText");

test("texts: cleaned to plain GSM-7 so they cost half as much, and segments are counted right", () => {
  const raw = "WiserShifts · Silver Comet: Kim called out of CNA Tue Nov 10, 7a–3p. 4 can cover it without overtime. Fill it: https://wisershifts.com/schedule?callout=6a42cc5063356ce09304e84a";
  assert.equal(segments(raw), 3, "one – or · makes the whole text 70 characters a segment");
  const clean = toGsm(raw);
  assert.match(clean, /WiserShifts - Silver Comet: .* 7a-3p\./);
  assert.equal(segments(clean), 2);
  assert.equal(toGsm("José’s “shift” … 😀 ok"), 'José\'s "shift" ... ok', "accents GSM has stay; curly quotes and emoji don't");
  assert.equal(segments("a".repeat(160)), 1);
  assert.equal(segments("a".repeat(161)), 2);
  assert.equal(segments("{".repeat(80)), 1, "{ counts as two");
  assert.equal(segments("{".repeat(81)), 2);
});

test("call-out offers: ranked by who says yes, then fewest hours; first wave only, rest wait", async () => {
  const CalloutOffer = require("../models/calloutOfferModel");
  const notify = require("../utils/notify");
  const staffLinks = require("../utils/staffLinks");
  const orig = [CalloutOffer.aggregate, CalloutOffer.create, notify.sendToStaff, staffLinks.getStaffLinkUrl];
  const sentTo = [];
  CalloutOffer.aggregate = async () => [
    { _id: "s3", sent: 4, yes: 4 },
    { _id: "s1", sent: 4, yes: 0 },
  ];
  CalloutOffer.create = async (doc) => ({ ...doc, _id: "o1", recipients: doc.recipients.map((r) => ({ ...r })), save: async () => {} });
  notify.sendToStaff = async ({ staff }) => (sentTo.push(String(staff._id)), { delivered: true, channel: "sms" });
  staffLinks.getStaffLinkUrl = async () => "https://x/s/abc";
  delete require.cache[require.resolve("../utils/callouts")];
  try {
    const { rankForOffer, sendCalloutOffer, WAVE_SIZE } = require("../utils/callouts");
    const rows = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"].map((id, i) => ({ staff: { _id: id, name: id }, weekMinutes: (7 - i) * 60 }));
    const ranked = await rankForOffer("t1", rows);
    assert.equal(String(ranked[0].staff._id), "s3", "always says yes: first");
    assert.equal(String(ranked.at(-1).staff._id), "s1", "never says yes: last");
    assert.deepEqual(ranked.slice(1, 3).map((r) => r.staff._id), ["s7", "s6"], "no history: fewest hours first");

    const coverage = { _id: "c1", tenantId: "t1", role: "cna", startTime: new Date(Date.now() + 2 * 864e5), endTime: new Date(Date.now() + 2 * 864e5 + 8 * 3600e3) };
    const offer = await sendCalloutOffer({ tenant: { _id: "t1", name: "Silver Comet" }, coverage, people: ranked.map((r) => r.staff), timezone: "America/New_York", waves: true });
    assert.equal(sentTo.length, WAVE_SIZE, "only the first wave now");
    assert.equal(offer.recipients.filter((r) => !r.sentAt).length, 7 - WAVE_SIZE);
    assert.ok(offer.nextWaveAt > new Date());

    sentTo.length = 0;
    const soon = { ...coverage, startTime: new Date(Date.now() + 2 * 3600e3) };
    await sendCalloutOffer({ tenant: { _id: "t1", name: "Silver Comet" }, coverage: soon, people: ranked.map((r) => r.staff), timezone: "America/New_York", waves: true });
    assert.equal(sentTo.length, 7, "starts within 3 hours: everyone at once");
  } finally {
    [CalloutOffer.aggregate, CalloutOffer.create, notify.sendToStaff, staffLinks.getStaffLinkUrl] = orig;
    delete require.cache[require.resolve("../utils/callouts")];
  }
});

test("reminders: smart mode skips people who worked the day before", async () => {
  const Schedule = require("../models/scheduleModel");
  const { workedDayBefore } = require("../utils/reminderJobs");
  const orig = Schedule.exists;
  let q = null;
  Schedule.exists = async (query) => ((q = query), { _id: "x" });
  try {
    const shift = { _id: "a", tenantId: "t1", staffId: "s1", startTime: new Date("2026-11-10T12:00:00Z") };
    assert.equal(await workedDayBefore(shift, "America/New_York"), true);
    assert.equal(q.startTime.$gte.toISOString(), "2026-11-09T05:00:00.000Z", "the calendar day before, facility time");
    assert.equal(q.startTime.$lt.toISOString(), "2026-11-10T05:00:00.000Z");
    Schedule.exists = async () => null;
    assert.equal(await workedDayBefore(shift, "America/New_York"), false);
  } finally {
    Schedule.exists = orig;
  }
});
