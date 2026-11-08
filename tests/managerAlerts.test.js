const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMorningSummary } = require("../utils/morningSummary");

const at = (iso) => new Date(iso);
const base = {
  facility: "Silver Comet Village",
  timezone: "America/New_York",
  shiftsToday: 34,
  open: [],
  callouts: [],
  pendingTimeOff: 0,
  pendingSwaps: 0,
  overtime: [],
};

test("morning summary: an all-covered day is short and needs no link", () => {
  const s = buildMorningSummary(base, { name: "Amanda Akins" }, "https://app.example/dashboard");
  assert.equal(s.sms, "WiserShifts · Silver Comet Village: Good morning, Amanda. 34 shifts today, every slot filled.");
  assert.equal(s.needsYou, 0);
  assert.equal(s.subject, "Silver Comet Village today: all covered");
});

test("morning summary: open slots, overnight call-outs, requests and overtime, with the link", () => {
  const facts = {
    ...base,
    open: [
      { role: "cna", start: at("2026-11-09T12:00:00Z") },
      { role: "med_tech", start: at("2026-11-09T20:00:00Z") },
    ],
    callouts: [
      { name: "Kim", role: "cna", start: at("2026-11-09T12:00:00Z"), coveredBy: "Jo" },
      { name: "Dana", role: "cna", start: at("2026-11-09T20:00:00Z"), coveredBy: null },
    ],
    pendingTimeOff: 1,
    overtime: [{ name: "Lee", hours: 42 }],
  };
  const s = buildMorningSummary(facts, { name: "William Smith" }, "https://app.example/dashboard");
  assert.match(s.sms, /Good morning, William\./);
  assert.match(s.sms, /34 shifts today, 2 slots still open \(7am CNA, 3pm Med Tech\)\./);
  assert.match(s.sms, /Jo is covering for Kim; Dana \((Mon )?3pm CNA\) still needs cover\./);
  assert.match(s.sms, /Waiting on you: 1 time-off request\./);
  assert.match(s.sms, /Heading into overtime this week: Lee \(42h\)\./);
  assert.match(s.sms, /https:\/\/app\.example\/dashboard$/);
  assert.equal(s.needsYou, 4);
  assert.equal(s.subject, "Silver Comet Village today: 4 things need you");
  assert.match(s.html, /Open today/);
});

test("manager alerts: owners and admins are texted when opted in, asked once, and the summary respects its switch", async () => {
  const { alertManagers } = require("../utils/managerAlerts");
  const Tenant = require("../models/tenantModel");
  const Preferences = require("../models/preferencesModel");
  const User = require("../models/userModel");
  const notify = require("../utils/notify");
  const orig = [Tenant.findById, Preferences.find, User.find, notify.sendToStaff];
  const sent = [];
  Tenant.findById = () => ({ lean: async () => ({ _id: "t1", name: "Silver Comet", plan: "growth", subscriptionStatus: "active" }) });
  User.find = () => ({ select: () => ({ lean: async () => [
    { _id: "m1", name: "Amanda Akins", phoneE164: "+14705550100", smsConsent: { status: "opted_in" } },
    { _id: "m2", name: "Melanie Hendrix", email: "m@example.com", smsConsent: { status: "none" } },
    { _id: "m3", name: "Off Login", loginEnabled: false },
  ] }) });
  Preferences.find = () => ({ select: () => ({ lean: async () => [{ staffId: "m2", morningSummaryEnabled: false }] }) });
  try {
    // sendToStaff is required by managerAlerts at load; patch the module's export it calls.
    delete require.cache[require.resolve("../utils/managerAlerts")];
    notify.sendToStaff = async (x) => (sent.push(x), { delivered: true, channel: x.staff.phoneE164 ? "sms" : "email" });
    const fresh = require("../utils/managerAlerts");
    const r = await fresh.alertManagers({ tenantId: "t1", kind: "callout_alert", sms: (m) => `Hi ${m.name}`, emailSubject: "S", emailHtml: "H" });
    assert.deepEqual(r.map((x) => x.managerId), ["m1", "m2"], "someone without a login isn't alerted");
    assert.equal(sent[0].sms, "Hi Amanda Akins");
    sent.length = 0;
    await fresh.alertManagers({ tenantId: "t1", kind: "morning_summary", sms: "x", emailSubject: "S", emailHtml: "H" });
    assert.deepEqual(sent.map((x) => String(x.staff._id)), ["m1"], "Melanie turned the morning summary off");
  } finally {
    [Tenant.findById, Preferences.find, User.find, notify.sendToStaff] = orig;
    delete require.cache[require.resolve("../utils/managerAlerts")];
  }
  assert.equal(typeof alertManagers, "function");
});

test("roles read naturally in texts", () => {
  const { role } = require("../utils/morningSummary");
  assert.equal(role("cna"), "CNA");
  assert.equal(role("med_tech"), "Med Tech");
  assert.equal(role("concierge"), "Concierge");
  assert.equal(role("RN"), "RN");
});

test("next step: earlier steps first; getting-started steps stop for abandoned signups", () => {
  const { nextStep, buildNudge } = require("../utils/setupNudge");
  const link = (p) => `https://app.example${p}`;
  const now = new Date("2026-11-09T15:00:00Z");
  const fresh = { createdAt: new Date("2026-11-01"), setupDone: false, staff: 0, staffWithPhone: 0, optedIn: 0, smsPlan: true, thisWeekPublished: false, nextWeekPublished: false, weekday: 1 };
  assert.equal(nextStep(fresh, link, now).key, "setup");
  assert.equal(nextStep({ ...fresh, createdAt: new Date("2026-08-01") }, link, now), null, "signed up months ago and never set up: leave them be");
  assert.equal(nextStep({ ...fresh, setupDone: true }, link, now).key, "staff");
  assert.equal(nextStep({ ...fresh, setupDone: true, staff: 12 }, link, now).key, "phones");
  const ready = { ...fresh, setupDone: true, staff: 12, staffWithPhone: 10 };
  assert.equal(nextStep(ready, link, now).key, "publish");
  assert.equal(nextStep({ ...ready, thisWeekPublished: true, weekday: 2 }, link, now)?.key, "optin");
  assert.equal(nextStep({ ...ready, thisWeekPublished: true, weekday: 4 }, link, now).key, "publish_next", "from Thursday, next week");
  assert.equal(nextStep({ ...ready, thisWeekPublished: true, nextWeekPublished: true, optedIn: 8 }, link, now), null);
  assert.equal(nextStep({ ...ready, thisWeekPublished: true, smsPlan: false }, link, now), null, "no texting plan: don't ask for opt-ins");

  const n = buildNudge(nextStep(fresh, link, now), "Little Bonanza", { name: "Joseph Adeyemo" });
  assert.match(n.sms, /^WiserShifts · Little Bonanza: Hi Joseph\. Finish setting up WiserShifts\..*https:\/\/app\.example\/setup$/);
  assert.equal(n.subject, "Finish setting up Little Bonanza");
  assert.match(n.html, /Finish setup/);
});

test("morning summary: carries the next step, and links to it on an otherwise quiet day", () => {
  const facts = { ...base, open: [], step: { key: "publish_next", text: "Next week isn't published yet.", link: "https://app.example/schedule" } };
  const s = buildMorningSummary(facts, { name: "Melanie" }, "https://app.example/dashboard");
  assert.match(s.sms, /Next step: Next week isn't published yet\. https:\/\/app\.example\/schedule$/);
  assert.equal(s.needsYou, 1);
});

test("opt-in for managers: asks once with the managers' wording; skips no phone, no texting plan, STOP and already yes", async () => {
  const smsMod = require("../utils/sendSMS");
  const User = require("../models/userModel");
  const OutboundMessage = require("../models/outboundMessageModel");
  const orig = [smsMod.sendSMS, User.updateOne, OutboundMessage.create];
  const texts = [];
  const updates = [];
  smsMod.sendSMS = async (to, body) => (texts.push({ to, body }), { success: true });
  User.updateOne = async (f, u) => updates.push([f, u]);
  OutboundMessage.create = async () => ({});
  delete require.cache[require.resolve("../utils/notify")];
  try {
    const { requestOptIn } = require("../utils/notify");
    const tenant = { _id: "t1", name: "Little Bonanza" };
    const paid = "growth";
    const p = (consent, phone = "+14705550100") => ({ _id: "m1", phoneE164: phone, smsConsent: { status: consent } });
    assert.deepEqual(await requestOptIn({ tenant, planKey: paid, person: p("none", null), manager: true }), { sent: false, reason: "no_phone" });
    assert.deepEqual(await requestOptIn({ tenant, planKey: "free", person: p("none"), manager: true }), { sent: false, reason: "sms_needs_upgrade" });
    assert.deepEqual(await requestOptIn({ tenant, planKey: paid, person: p("opted_out"), manager: true }), { sent: false, reason: "opted_out" });
    assert.deepEqual(await requestOptIn({ tenant, planKey: paid, person: p("opted_in"), manager: true }), { sent: false, reason: "already_opted_in" });
    assert.deepEqual(await requestOptIn({ tenant, planKey: paid, person: p("pending"), manager: true }), { sent: true }, "asking again is allowed (HQ's button)");
    assert.match(texts[0].body, /^Little Bonanza uses WiserShifts\. Reply START to get texts when someone calls out or asks for time off, plus a short morning summary\./);
    assert.match(texts[0].body, /Reply STOP to opt out, HELP for help\.$/);
    assert.equal(updates[0][1].$set.smsConsent.status, "pending");
  } finally {
    [smsMod.sendSMS, User.updateOne, OutboundMessage.create] = orig;
    delete require.cache[require.resolve("../utils/notify")];
  }
});

test("members: edit name, email and phone together; a taken email or blank name is refused", async () => {
  const { applyContact } = require("../controllers/memberController")._test;
  const User = require("../models/userModel");
  const orig = User.findOne;
  const saved = [];
  const member = (extra = {}) => ({ _id: "m1", name: "Joseph", email: "old@example.com", passwordHash: "x", save: async function () { saved.push({ name: this.name, email: this.email }); }, ...extra });
  try {
    User.findOne = () => ({ select: () => ({ lean: async () => null }) });
    const m = member();
    assert.equal(await applyContact({ body: { name: " Joseph Adeyemo ", email: "New@Example.com" }, tenantId: "t1" }, m), null);
    assert.equal(m.name, "Joseph Adeyemo");
    assert.equal(m.email, "new@example.com");
    assert.equal(saved.length, 1);
    assert.deepEqual(await applyContact({ body: { name: "  " }, tenantId: "t1" }, member()), { status: 400, message: "Name can't be empty." });
    assert.equal((await applyContact({ body: { email: "not-an-email" }, tenantId: "t1" }, member())).status, 400);
    User.findOne = () => ({ select: () => ({ lean: async () => ({ tenantId: "t1" }) }) });
    assert.deepEqual(await applyContact({ body: { email: "taken@example.com" }, tenantId: "t1" }, member()), { status: 409, message: "Someone on your team already uses that email." });
  } finally {
    User.findOne = orig;
  }
});
