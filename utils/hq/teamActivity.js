/**
 * HQ team activity: for one workspace, every person (managers and staff)
 * and how they use WiserShifts: when they last opened the app or their
 * link, on what device, whether texts reach them, and what they do
 * (shifts worked, clock-ins, call-outs picked up, swaps, time off).
 *
 * summarizePerson and summarizeTeam are pure (tested with plain objects);
 * loadTeam and loadTeamCounts query.
 */
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT_ROLES = ["owner", "administrator", "scheduler", "viewer"];
const rolesOf = (u) => [...new Set([...(u.roles || []), u.role].filter(Boolean))];
const latest = (...ds) => ds.filter(Boolean).map((d) => new Date(d)).sort((a, b) => b - a)[0] || null;
const within = (d, now, days) => Boolean(d) && now - new Date(d) <= days * DAY;

/** "iPhone", "Android", "Mac", "Windows"… from a browser's user agent. */
function deviceOf(ua = "") {
  const s = String(ua || "");
  if (/iPhone/i.test(s)) return "iPhone";
  if (/iPad/i.test(s)) return "iPad";
  if (/Android/i.test(s)) return "Android";
  if (/Macintosh|Mac OS X/i.test(s)) return "Mac";
  if (/Windows/i.test(s)) return "Windows";
  if (/CrOS/i.test(s)) return "Chromebook";
  if (/Linux/i.test(s)) return "Linux";
  return s ? "Other" : "Unknown";
}

/** How recently someone used it, in words HQ shows. */
function seenLevel(lastSeenAt, now) {
  if (!lastSeenAt) return "never";
  const days = (now - new Date(lastSeenAt)) / DAY;
  if (days <= 7) return "week";
  if (days <= 30) return "month";
  return "quiet";
}

/** Can a text reach them, and if not, why. */
function textingOf(user, failed30, lastError) {
  const consent = user.smsConsent?.status || "none";
  if (!user.phoneE164) return { ok: false, why: "No mobile number" };
  if (consent === "opted_out") return { ok: false, why: "Replied STOP" };
  if (failed30 > 0) return { ok: false, why: `Texts failing${lastError ? `: ${lastError}` : ""}` };
  if (consent === "opted_in") return { ok: true, why: "Opted in" };
  return { ok: true, why: consent === "pending" ? "Invited earlier, hasn't opted in" : "Hasn't opted in yet" };
}

/**
 * One person. Lists are already this person's: their link and devices,
 * shifts (last 30 days and next 7), clock-ins, call-out offers, swaps,
 * time off and texts.
 */
function summarizePerson({ user, link = null, devices = [], shifts = [], entries = [], offers = [], swaps = [], timeOffs = [], messages = [], now = new Date() }) {
  const roles = rolesOf(user);
  const accountRoles = roles.filter((r) => ACCOUNT_ROLES.includes(r));
  const jobRoles = roles.filter((r) => !ACCOUNT_ROLES.includes(r) && r !== "staff");
  const activeDevices = devices.filter((d) => !d.revokedAt);
  const linkOpenedAt = latest(link?.lastUsedAt, ...activeDevices.map((d) => d.lastUsedAt));
  const appSeenAt = user.lastSeenAt || null;
  const lastSeenAt = latest(appSeenAt, linkOpenedAt);
  const past = shifts.filter((s) => new Date(s.startTime) < now);
  const next7 = shifts.filter((s) => new Date(s.startTime) >= now && new Date(s.startTime) - now <= 7 * DAY && !["call_out"].includes(s.status));
  const in30 = (d) => within(d, now, 30);
  const worked14 = past.filter((s) => within(s.startTime, now, 14) && ["completed", "in_progress", "left_early"].includes(s.status)).length;
  const clockIns = entries.filter((e) => e.clockInAt);
  const asked30 = offers.filter((o) => in30(o.sentAt));
  const pickedUp30 = asked30.filter((o) => o.response === "yes");
  const failed = messages.filter((m) => m.status === "failed" && in30(m.createdAt));
  const sms30 = messages.filter((m) => m.channel === "sms" && m.status === "sent" && in30(m.createdAt));
  return {
    _id: String(user._id),
    name: user.name || "(no name)",
    email: user.email || "",
    phone: user.phoneE164 || "",
    accountRoles,
    jobRoles,
    manager: Boolean(user.loginEnabled) || accountRoles.length > 0,
    addedAt: user.createdAt || null,
    // How they get in: the app (an account) and/or their personal link.
    access: {
      app: Boolean(user.loginEnabled),
      link: Boolean(link && !link.revokedAt),
      pinSet: Boolean(user.linkPinSetAt),
      devices: [...new Set(activeDevices.map((d) => deviceOf(d.userAgent)))],
    },
    appSeenAt,
    linkOpenedAt,
    lastSeenAt,
    seen: seenLevel(lastSeenAt, now),
    texting: textingOf(user, failed.length, failed[0]?.error || ""),
    texts30: sms30.length,
    shiftsNext7: next7.length,
    worked14,
    noShows30: past.filter((s) => s.status === "no_show" && in30(s.startTime)).length,
    callOuts30: shifts.filter((s) => s.status === "call_out" && in30(s.startTime)).length,
    lastClockInAt: latest(...clockIns.map((e) => e.clockInAt)),
    clockIns14: clockIns.filter((e) => within(e.clockInAt, now, 14)).length,
    callOutsAsked30: asked30.length,
    callOutsPickedUp30: pickedUp30.length,
    swaps30: swaps.filter((s) => in30(s.createdAt)).length,
    timeOff30: timeOffs.filter((t) => in30(t.createdAt)).length,
  };
}

/** The whole team at a glance, and what to do about it. */
function summarizeTeam(people) {
  const staff = people.filter((p) => !p.manager);
  const count = (list, f) => list.filter(f).length;
  const summary = {
    people: people.length,
    managers: people.length - staff.length,
    staff: staff.length,
    seen7: count(people, (p) => p.seen === "week"),
    staffSeen7: count(staff, (p) => p.seen === "week"),
    neverSeen: count(people, (p) => p.seen === "never"),
    staffNeverSeen: count(staff, (p) => p.seen === "never"),
    cantText: count(people, (p) => !p.texting.ok),
    pinSet: count(staff, (p) => p.access.pinSet),
    clockingIn: count(people, (p) => p.clockIns14 > 0),
    pickedUp30: people.reduce((n, p) => n + p.callOutsPickedUp30, 0),
  };
  const tips = [];
  const are = (n) => (n === 1 ? "1 staff member is" : `${n} staff are`);
  const have = (n) => (n === 1 ? "1 staff member has" : `${n} staff have`);
  if (summary.staffNeverSeen) tips.push(`${have(summary.staffNeverSeen)} never opened their link. Resend links from Staff, or ask the scheduler to show them at shift change.`);
  if (summary.cantText) tips.push(`${summary.cantText === 1 ? "1 person" : `${summary.cantText} people`} can't get texts (no number, replied STOP, or texts failing). Fix numbers so call-outs reach them.`);
  const scheduledButQuiet = count(staff, (p) => p.shiftsNext7 > 0 && p.seen !== "week" && p.seen !== "never");
  if (scheduledButQuiet) tips.push(`${are(scheduledButQuiet)} on next week's schedule but haven't looked in over a week.`);
  const managersQuiet = count(people, (p) => p.manager && p.seen !== "week");
  if (managersQuiet) tips.push(`${managersQuiet} manager${managersQuiet === 1 ? " hasn't" : "s haven't"} opened the app this week.`);
  return { ...summary, tips };
}

const BY_STAFF = (list, key = "staffId") => {
  const m = new Map();
  for (const x of list || []) {
    const k = String(x[key]);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};

/** Every active person in one workspace, most recently seen first, with the team summary. */
async function loadTeam(tenantId, now = new Date()) {
  const User = require("../../models/userModel");
  const StaffLink = require("../../models/staffLinkModel");
  const StaffDevice = require("../../models/staffDeviceModel");
  const Schedule = require("../../models/scheduleModel");
  const TimeEntry = require("../../models/timeEntryModel");
  const CalloutOffer = require("../../models/calloutOfferModel");
  const ShiftSwap = require("../../models/shiftSwapModel");
  const TimeOff = require("../../models/timeOffModel");
  const OutboundMessage = require("../../models/outboundMessageModel");

  const since30 = new Date(now - 30 * DAY);
  const in7 = new Date(now.getTime() + 7 * DAY);
  const users = await User.find({ tenantId, status: { $ne: "archived" } })
    .select("name email phoneE164 role roles loginEnabled lastSeenAt linkPinSetAt smsConsent createdAt")
    .lean();
  const ids = users.map((u) => u._id);
  const [links, devices, shifts, entries, offers, swaps, timeOffs, messages] = await Promise.all([
    StaffLink.find({ tenantId, staffId: { $in: ids }, revokedAt: null }).select("staffId lastUsedAt revokedAt createdAt").lean(),
    StaffDevice.find({ tenantId, staffId: { $in: ids }, revokedAt: null }).select("staffId userAgent lastUsedAt revokedAt").lean(),
    Schedule.find({ tenantId, staffId: { $in: ids }, startTime: { $gte: since30, $lte: in7 } }).select("staffId startTime status").lean(),
    TimeEntry.find({ tenantId, staffId: { $in: ids }, clockInAt: { $gte: since30 } }).select("staffId clockInAt").lean(),
    CalloutOffer.find({ tenantId, createdAt: { $gte: since30 } }).select("recipients").lean(),
    ShiftSwap.find({ tenantId, requesterStaffId: { $in: ids }, createdAt: { $gte: since30 } }).select("requesterStaffId createdAt").lean(),
    TimeOff.find({ tenantId, staffId: { $in: ids }, createdAt: { $gte: since30 } }).select("staffId createdAt").lean(),
    OutboundMessage.find({ tenantId, staffId: { $in: ids }, createdAt: { $gte: since30 } }).select("staffId channel status error createdAt").sort({ createdAt: -1 }).lean(),
  ]);
  const recipients = (offers || []).flatMap((o) => o.recipients || []);
  const linkBy = new Map((links || []).map((l) => [String(l.staffId), l]));
  const [devicesBy, shiftsBy, entriesBy, offersBy, swapsBy, timeOffBy, messagesBy] = [
    BY_STAFF(devices),
    BY_STAFF(shifts),
    BY_STAFF(entries),
    BY_STAFF(recipients),
    BY_STAFF(swaps, "requesterStaffId"),
    BY_STAFF(timeOffs),
    BY_STAFF(messages),
  ];
  const people = users
    .map((user) => {
      const k = String(user._id);
      return summarizePerson({
        user,
        link: linkBy.get(k) || null,
        devices: devicesBy.get(k) || [],
        shifts: shiftsBy.get(k) || [],
        entries: entriesBy.get(k) || [],
        offers: offersBy.get(k) || [],
        swaps: swapsBy.get(k) || [],
        timeOffs: timeOffBy.get(k) || [],
        messages: messagesBy.get(k) || [],
        now,
      });
    })
    .sort((a, b) => Number(b.manager) - Number(a.manager) || (b.lastSeenAt ? new Date(b.lastSeenAt) : 0) - (a.lastSeenAt ? new Date(a.lastSeenAt) : 0) || a.name.localeCompare(b.name));
  return { people, summary: summarizeTeam(people) };
}

/**
 * For the workspace list: people, how many were seen this week, and how
 * many never, per workspace (a few grouped queries for all of them).
 */
async function loadTeamCounts(tenantIds, now = new Date()) {
  const User = require("../../models/userModel");
  const StaffLink = require("../../models/staffLinkModel");
  const since7 = new Date(now - 7 * DAY);
  const [users, links] = await Promise.all([
    User.find({ tenantId: { $in: tenantIds }, status: { $ne: "archived" } }).select("tenantId lastSeenAt").lean(),
    StaffLink.find({ tenantId: { $in: tenantIds }, revokedAt: null }).select("tenantId staffId lastUsedAt").lean(),
  ]);
  const linkBy = new Map((links || []).map((l) => [String(l.staffId), l.lastUsedAt]));
  const out = new Map(tenantIds.map((id) => [String(id), { people: 0, seen7: 0, neverSeen: 0, lastSeenAt: null }]));
  for (const u of users || []) {
    const c = out.get(String(u.tenantId));
    if (!c) continue;
    const seen = latest(u.lastSeenAt, linkBy.get(String(u._id)));
    c.people += 1;
    if (!seen) c.neverSeen += 1;
    else if (seen >= since7) c.seen7 += 1;
    c.lastSeenAt = latest(c.lastSeenAt, seen);
  }
  return out;
}

module.exports = { summarizePerson, summarizeTeam, loadTeam, loadTeamCounts, deviceOf };
