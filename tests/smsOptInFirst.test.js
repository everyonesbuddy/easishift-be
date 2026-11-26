const test = require("node:test");
const assert = require("node:assert/strict");

process.env.STAFF_LINK_KEY = process.env.STAFF_LINK_KEY || "c".repeat(64);
const smsMod = require("../utils/sendSMS");
const emailMod = require("../utils/sendEmail");
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");
const OutboundMessage = require("../models/outboundMessageModel");
const Preferences = require("../models/preferencesModel");

function stubs() {
  const orig = [smsMod.sendSMS, emailMod.sendEmail, User.updateOne, User.updateMany, User.find, Tenant.find, OutboundMessage.create, OutboundMessage.aggregate, Preferences.findOne];
  const out = { texts: [], emails: [], writes: [] };
  smsMod.sendSMS = async (to, body) => (out.texts.push({ to, body }), { success: true, segments: 1 });
  emailMod.sendEmail = async (to, subject) => (out.emails.push({ to, subject }), { success: true });
  User.updateOne = async (f, u) => (out.writes.push(u), {});
  User.updateMany = async (f, u) => (out.writes.push(u), {});
  OutboundMessage.create = async () => ({});
  OutboundMessage.aggregate = async () => [];
  Preferences.findOne = () => ({ select: () => ({ lean: async () => null }) });
  out.restore = () => {
    [smsMod.sendSMS, emailMod.sendEmail, User.updateOne, User.updateMany, User.find, Tenant.find, OutboundMessage.create, OutboundMessage.aggregate, Preferences.findOne] = orig;
    for (const m of ["../utils/notify", "../controllers/smsController", "../controllers/staffPortalController"]) delete require.cache[require.resolve(m)];
  };
  for (const m of ["../utils/notify", "../controllers/smsController", "../controllers/staffPortalController"]) delete require.cache[require.resolve(m)];
  return out;
}

test("nobody is texted before they opt in, not even to ask", async () => {
  const s = stubs();
  try {
    const { sendToStaff } = require("../utils/notify");
    const tenant = { _id: "t1", name: "Silver Comet" };
    const phoneOnly = { _id: "s1", phoneE164: "+14045550100", smsConsent: { status: "none" } };
    const r = await sendToStaff({ tenant, planKey: "growth", staff: phoneOnly, kind: "shift_added", sms: "You're on Fri", emailSubject: "x", emailHtml: "<p>x</p>" });
    assert.deepEqual(r, { delivered: false, reason: "awaiting_opt_in" });
    const both = { ...phoneOnly, email: "s@example.com" };
    const r2 = await sendToStaff({ tenant, planKey: "growth", staff: both, kind: "shift_added", sms: "You're on Fri", emailSubject: "x", emailHtml: "<p>x</p>" });
    assert.equal(r2.channel, "email");
    assert.equal(s.texts.length, 0, "no opt-in invitation text, ever");
    const yes = { ...phoneOnly, smsConsent: { status: "opted_in" } };
    const r3 = await sendToStaff({ tenant, planKey: "growth", staff: yes, kind: "shift_added", sms: "You're on Fri", emailSubject: "x", emailHtml: "<p>x</p>" });
    assert.equal(r3.channel, "sms", "once they've opted in, texts flow");
  } finally {
    s.restore();
  }
});

function inbound(body, from = "+14045550100") {
  let xml = "";
  const res = { type: () => res, send: (x) => (xml = x), status: () => res };
  return { req: { body: { From: from, Body: body }, get: () => "", originalUrl: "/api/v1/sms/inbound", headers: {} }, res, xml: () => xml };
}

test("texting JOIN opts a known number in (recorded as a keyword); an unknown number is told to ask their scheduler", async () => {
  const s = stubs();
  delete process.env.TWILIO_AUTH_TOKEN;
  try {
    const staffLinks = require("../utils/staffLinks");
    const origLink = staffLinks.getStaffLinkUrl;
    staffLinks.getStaffLinkUrl = async () => "https://wisershifts.com/s/abc";
    User.find = async () => [{ _id: "s1", tenantId: "t1", name: "Kim", smsConsent: { status: "none" } }];
    Tenant.find = () => ({ select: () => ({ lean: async () => [{ _id: "t1", name: "Silver Comet" }] }) });
    const ctrl = require("../controllers/smsController");
    const a = inbound("Join");
    await ctrl.handleInbound(a.req, a.res, (e) => { throw e; });
    assert.match(a.xml(), /subscribed to WiserShifts schedule texts from Silver Comet/);
    const w = s.writes[0].$set.smsConsent;
    assert.equal(w.status, "opted_in");
    assert.equal(w.method, "keyword");
    assert.match(w.evidence.wording, /Texted "Join"/);

    User.find = async () => [];
    const b = inbound("JOIN", "+19995550000");
    await ctrl.handleInbound(b.req, b.res, (e) => { throw e; });
    assert.match(b.xml(), /couldn&apos;t find this number/);
    staffLinks.getStaffLinkUrl = origLink;
  } finally {
    s.restore();
  }
});

test("schedule page: ticking the box records the wording, time and device, then confirms by text; unticking stops", async () => {
  const s = stubs();
  try {
    const staffLinks = require("../utils/staffLinks");
    const origLink = staffLinks.getStaffLinkUrl;
    staffLinks.getStaffLinkUrl = async () => "https://wisershifts.com/s/abc";
    const ctrl = require("../controllers/staffPortalController");
    let body;
    let status = 200;
    const res = { status: (c) => ((status = c), res), json: (b) => ((body = b), res) };
    const req = (agree, me = { _id: "s1", phoneE164: "+14045550100", smsConsent: { status: "none" } }) => ({ body: { agree }, user: me, tenantId: "t1", tenant: { name: "Silver Comet" }, plan: { key: "growth" }, headers: { "user-agent": "iPhone Safari", "x-forwarded-for": "5.6.7.8, 10.0.0.1" }, ip: "10.0.0.1" });

    await ctrl.setTextConsent(req(undefined), res, (e) => { throw e; });
    assert.equal(status, 400, "no tick, no yes");
    assert.equal(s.texts.length, 0);

    status = 200;
    await ctrl.setTextConsent(req(true), res, (e) => { throw e; });
    assert.equal(body.smsStatus, "opted_in");
    const ev = s.writes.at(-1).$set.smsConsent.evidence;
    assert.equal(ev.method, "web_form");
    assert.match(ev.wording, /^Text me my schedule/);
    assert.equal(ev.ip, "5.6.7.8");
    assert.equal(ev.userAgent, "iPhone Safari");
    assert.match(s.texts[0].body, /subscribed to WiserShifts schedule texts from Silver Comet\. Your schedule: https:\/\/wisershifts\.com\/s\/abc/);

    await ctrl.setTextConsent(req(false), res, (e) => { throw e; });
    assert.equal(body.smsStatus, "opted_out");

    status = 200;
    await ctrl.setTextConsent(req(true, { _id: "s2", smsConsent: { status: "none" } }), res, (e) => { throw e; });
    assert.equal(status, 400, "no number on file");
    staffLinks.getStaffLinkUrl = origLink;
  } finally {
    s.restore();
  }
});
