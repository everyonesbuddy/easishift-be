const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizePerson, summarizeTeam, deviceOf } = require("../utils/hq/teamActivity");

const NOW = new Date("2026-11-23T15:00:00Z");
const ago = (d) => new Date(NOW - d * 86400000);
const ahead = (d) => new Date(NOW.getTime() + d * 86400000);

test("a staff member on their link: last seen is the later of the link and their phone, with the device", () => {
  const p = summarizePerson({
    user: { _id: "u1", name: "Ada", role: "staff", roles: ["cna"], phoneE164: "+15550001", smsConsent: { status: "opted_in" }, linkPinSetAt: ago(20) },
    link: { lastUsedAt: ago(6) },
    devices: [{ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", lastUsedAt: ago(2) }, { userAgent: "Windows NT", lastUsedAt: ago(40), revokedAt: ago(30) }],
    shifts: [
      { startTime: ago(3), status: "completed" },
      { startTime: ago(10), status: "no_show" },
      { startTime: ago(12), status: "call_out" },
      { startTime: ahead(2), status: "scheduled" },
      { startTime: ahead(9), status: "scheduled" },
    ],
    entries: [{ clockInAt: ago(3) }, { clockInAt: ago(20) }],
    offers: [{ sentAt: ago(5), response: "yes" }, { sentAt: ago(8), response: "none" }, { sentAt: ago(45), response: "yes" }],
    swaps: [{ createdAt: ago(4) }],
    timeOffs: [{ createdAt: ago(40) }],
    messages: [{ channel: "sms", status: "sent", createdAt: ago(1) }],
    now: NOW,
  });
  assert.equal(p.manager, false);
  assert.deepEqual(p.jobRoles, ["cna"]);
  assert.deepEqual(p.access, { app: false, link: true, pinSet: true, devices: ["iPhone"] }, "a revoked device doesn't count");
  assert.equal(p.lastSeenAt.toISOString(), ago(2).toISOString());
  assert.equal(p.seen, "week");
  assert.deepEqual(p.texting, { ok: true, why: "Opted in" });
  assert.equal(p.shiftsNext7, 1);
  assert.equal(p.worked14, 1);
  assert.equal(p.noShows30, 1);
  assert.equal(p.callOuts30, 1);
  assert.equal(p.clockIns14, 1);
  assert.equal(p.callOutsAsked30, 2);
  assert.equal(p.callOutsPickedUp30, 1);
  assert.equal(p.swaps30, 1);
  assert.equal(p.timeOff30, 0);
});

test("a manager in the app; someone never seen; texts that can't reach them", () => {
  const m = summarizePerson({ user: { _id: "m", name: "Melanie", role: "owner", roles: ["owner"], loginEnabled: true, lastSeenAt: ago(9), phoneE164: "+1555" }, now: NOW });
  assert.equal(m.manager, true);
  assert.deepEqual(m.accountRoles, ["owner"]);
  assert.equal(m.seen, "month");
  const n = summarizePerson({ user: { _id: "n", name: "Bo", role: "staff" }, link: { lastUsedAt: null }, now: NOW });
  assert.equal(n.seen, "never");
  assert.deepEqual(n.texting, { ok: false, why: "No mobile number" });
  const stop = summarizePerson({ user: { _id: "s", name: "Cy", phoneE164: "+1", smsConsent: { status: "opted_out" } }, now: NOW });
  assert.equal(stop.texting.why, "Replied STOP");
  const bad = summarizePerson({ user: { _id: "b", name: "Di", phoneE164: "+1" }, messages: [{ channel: "sms", status: "failed", error: "Invalid number", createdAt: ago(3) }], now: NOW });
  assert.deepEqual(bad.texting, { ok: false, why: "Texts failing: Invalid number" });

  const team = summarizeTeam([m, n, stop, bad]);
  assert.equal(team.people, 4);
  assert.equal(team.managers, 1);
  assert.equal(team.staffNeverSeen, 3);
  assert.equal(team.cantText, 3);
  assert.match(team.tips[0], /3 staff have never opened their link/);
  assert.match(team.tips[1], /^3 people can.t get texts/);
  assert.ok(team.tips.some((t) => /1 manager hasn't opened the app this week/.test(t)));
});

test("devices by name", () => {
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "Android");
  assert.equal(deviceOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "Mac");
  assert.equal(deviceOf(""), "Unknown");
});
