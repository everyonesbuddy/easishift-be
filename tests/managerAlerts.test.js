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
