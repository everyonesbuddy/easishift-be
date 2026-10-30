/**
 * HQ numbers: how people come in, how far they get, and who drops off,
 * week by week (12 weeks) plus where they come from.
 */
const HqFacility = require("../models/hqFacilityModel");
const HqContact = require("../models/hqContactModel");
const HqActivity = require("../models/hqActivityModel");
const HqLead = require("../models/hqLeadModel");
const HqEmailSignal = require("../models/hqEmailSignalModel");
const HqSync = require("../models/hqSyncModel");
const Tenant = require("../models/tenantModel");
const { loadWorkspaces } = require("../utils/hq/productSignals");
const { lastWeeks, bucket } = require("../utils/hq/weeks");
const google = require("../utils/hq/google");
const klaviyo = require("../utils/hq/klaviyo");

const DAY = 86400000;
const HEARD = { google: "Google", linkedin: "LinkedIn", youtube: "YouTube", facebook: "Facebook", email: "Email from us", colleague: "A colleague", calculator: "Calculator", conference: "Event", other: "Other" };

const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Where a signup came from, in one short label (pure). */
function sourceLabel(w) {
  const s = w.signupSource || {};
  if (s.utm_source) return s.utm_source.toLowerCase();
  if (s.referrer) return hostOf(s.referrer) || "other site";
  if (w.heardAbout) return (HEARD[w.heardAbout.split(":")[0]] || w.heardAbout).toLowerCase();
  return s.landingPage ? "direct" : "unknown";
}

const tally = (list) => Object.entries(list.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {})).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);

async function cachedDaily() {
  const doc = await HqSync.findOne({ key: "web84" }).lean();
  if (doc?.data && doc.lastOkAt && Date.now() - new Date(doc.lastOkAt) < 6 * 3600000) return doc.data;
  try {
    const rows = await google.webDaily({ days: 84 });
    await HqSync.updateOne({ key: "web84" }, { $set: { data: rows, lastOkAt: new Date(), error: "" } }, { upsert: true });
    return rows;
  } catch (err) {
    await HqSync.updateOne({ key: "web84" }, { $set: { error: google.errText(err).slice(0, 300) } }, { upsert: true });
    return doc?.data || null;
  }
}

exports.getFunnel = async (req, res, next) => {
  try {
    const now = new Date();
    const weeks = lastWeeks(12, now);
    const from = weeks[0].start;
    const [workspaces, leads, tenants, acts, emailWeekly, daily] = await Promise.all([
      loadWorkspaces({ now }),
      HqLead.find({ createdAt: { $gte: from } }).select("createdAt newsletter source").lean(),
      Tenant.find({ $or: [{ createdAt: { $gte: from } }, { setupCompletedAt: { $gte: from } }] }).select("createdAt setupCompletedAt").lean(),
      HqActivity.find({ at: { $gte: from } }).select("at kind").lean(),
      HqSync.findOne({ key: "klaviyo-weekly" }).lean(),
      google.gaConfigured() ? cachedDaily() : null,
    ]);

    // Weekly email totals start being kept now; fill the past once, in the background.
    if (!emailWeekly && klaviyo.isConfigured()) klaviyo.rebuildEmailWeeks().catch((e) => console.error("HQ email weeks:", e.message));

    const visitors = daily
      ? Object.fromEntries(
          weeks.map((w) => [
            w.key,
            daily
              .filter((r) => {
                const d = new Date(`${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}T12:00:00Z`);
                return d >= w.start && d < w.end;
              })
              .reduce((s, r) => s + r.activeUsers, 0),
          ]),
        )
      : null;
    const ew = emailWeekly?.data?.weeks || {};
    const email = (field) => (emailWeekly ? Object.fromEntries(weeks.map((w) => [w.key, ew[w.key]?.[field] || 0])) : null);
    const byKind = (k) => bucket(weeks, acts.filter((a) => a.kind === k).map((a) => a.at));

    const rows = [
      { group: "In", key: "visitors", label: "Website visitors", values: visitors, note: visitors ? "" : "Connect Google Analytics" },
      { group: "In", key: "leads", label: "Calculator emails", values: bucket(weeks, leads.filter((l) => l.source !== "newsletter").map((l) => l.createdAt)) },
      { group: "In", key: "newsletter", label: "Newsletter sign-ups", values: bucket(weeks, leads.filter((l) => l.newsletter).map((l) => l.createdAt)) },
      { group: "In", key: "signups", label: "Workspace signups", values: bucket(weeks, tenants.map((t) => t.createdAt)) },
      { group: "Moving", key: "setup", label: "Finished setup", values: bucket(weeks, tenants.map((t) => t.setupCompletedAt)) },
      { group: "Moving", key: "realClicks", label: "Real clicks on Klaviyo emails", values: email("human"), note: emailWeekly ? "" : "Filling in from Klaviyo…" },
      { group: "Content", key: "delivered", label: "Klaviyo emails delivered", values: email("delivered") },
      { group: "Outreach", key: "calls", label: "Calls logged", values: byKind("call") },
      { group: "Outreach", key: "emails", label: "Cold emails sent", values: byKind("email") },
      { group: "Outreach", key: "linkedin", label: "LinkedIn touches", values: byKind("linkedin") },
      { group: "Outreach", key: "meetings", label: "Meetings", values: byKind("meeting") },
      { group: "Out", key: "unsub", label: "Unsubscribed", values: email("unsub") },
    ];

    // Where everyone is right now.
    const [facilities, contacted, contacts, clickers, replied] = await Promise.all([
      HqFacility.countDocuments(),
      HqFacility.countDocuments({ $or: [{ attempts: { $gt: 0 } }, { lastCallDate: { $ne: null } }] }),
      HqContact.countDocuments(),
      HqEmailSignal.countDocuments({ humanClicks: { $gt: 0 } }),
      HqContact.countDocuments({ emailReply: { $nin: ["", null] } }),
    ]);
    const touchedFacilities = (await HqActivity.distinct("facilityId", { facilityId: { $ne: null } })).length;
    const quiet = workspaces.filter((w) => w.setupDone && !w.active && w.lastActiveAt && now - new Date(w.lastActiveAt) > 14 * DAY);
    const stuck = workspaces.filter((w) => !w.setupDone && now - new Date(w.createdAt) > 7 * DAY);

    res.json({
      weeks: weeks.map((w) => w.key),
      rows,
      stages: [
        { key: "list", unit: "facility", label: "Facilities on our list", value: facilities },
        { key: "contacted", unit: "facility", label: "Facilities we've contacted", value: Math.max(contacted, touchedFacilities) },
        { key: "people", unit: "person", label: "People we can reach", value: contacts },
        { key: "engaged", unit: "person", label: "People who clicked or replied", value: clickers + replied },
        { key: "signedUp", unit: "workspace", label: "Signed up", value: workspaces.length },
        { key: "setup", unit: "workspace", label: "Finished setup", value: workspaces.filter((w) => w.setupDone).length },
        { key: "active", unit: "workspace", label: "Active this week", value: workspaces.filter((w) => w.active).length },
        { key: "leadership", unit: "workspace", label: "Leadership sees the numbers", value: workspaces.filter((w) => w.leadershipReached).length },
        { key: "paying", unit: "workspace", label: "Paying", value: workspaces.filter((w) => w.paid).length },
      ],
      out: [
        { key: "quiet", label: "Gone quiet (no login in 14+ days)", value: quiet.length, names: quiet.slice(0, 8).map((w) => w.name) },
        { key: "stuck", label: "Never finished setup (7+ days)", value: stuck.length, names: stuck.slice(0, 8).map((w) => w.name) },
        { key: "canceled", label: "Cancelled a subscription", value: workspaces.filter((w) => w.subscriptionStatus === "canceled").length, names: workspaces.filter((w) => w.subscriptionStatus === "canceled").slice(0, 8).map((w) => w.name) },
      ],
      sources: {
        signups: tally(workspaces.map(sourceLabel)),
        heard: tally(workspaces.filter((w) => w.heardAbout).map((w) => HEARD[w.heardAbout.split(":")[0]] || w.heardAbout)),
        roles: tally(workspaces.filter((w) => w.signupRole).map((w) => w.signupRole)),
        leads: tally(leads.map((l) => l.source.replace("calculator:", "").replace(/-/g, " "))),
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports.sourceLabel = sourceLabel;
