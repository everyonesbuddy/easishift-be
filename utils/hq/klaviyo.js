/**
 * Klaviyo (server-side, private key). Used for:
 *  - HQ email signals: delivered / real clicks / scanner clicks per address
 *  - calculator leads: upsert the profile, log a "Used Calculator" event, and
 *    subscribe to the newsletter list only when they ticked the box
 *
 * TODO(keys): KLAVIYO_PRIVATE_KEY  (Klaviyo → Settings → API keys → Create
 *   Private API Key; scopes: Events read/write, Metrics read, Profiles
 *   read/write, Lists read/write, Subscriptions write)
 * TODO(keys): KLAVIYO_LIST_ID      (the newsletter list calculator sign-ups
 *   join when they opt in; e.g. "Email List" = WekZB2 in your account)
 */
const axios = require("axios");
const { weekKey } = require("./weeks");

const BASE = "https://a.klaviyo.com/api";
const REVISION = "2024-10-15";
const DAY = 24 * 60 * 60 * 1000;

const isConfigured = () => Boolean(process.env.KLAVIYO_PRIVATE_KEY);

const client = () =>
  axios.create({
    baseURL: BASE,
    timeout: 20000,
    headers: {
      Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_KEY}`,
      revision: REVISION,
      accept: "application/vnd.api+json",
      "content-type": "application/vnd.api+json",
    },
  });

const errText = (err) =>
  err?.response?.data?.errors?.[0]?.detail || err?.response?.statusText || err?.message || "Klaviyo error";

// ── Writes (calculator leads) ───────────────────────────────────────────────
async function upsertProfile({ email, firstName, lastName, organization, properties = {} }) {
  const attributes = { email, properties };
  if (firstName) attributes.first_name = firstName;
  if (lastName) attributes.last_name = lastName;
  if (organization) attributes.organization = organization;
  await client().post("/profile-import", { data: { type: "profile", attributes } });
}

async function trackEvent({ email, metric, properties = {}, time = new Date() }) {
  await client().post("/events", {
    data: {
      type: "event",
      attributes: {
        properties,
        time: time.toISOString(),
        metric: { data: { type: "metric", attributes: { name: metric } } },
        profile: { data: { type: "profile", attributes: { email } } },
      },
    },
  });
}

/** Only call when the person explicitly opted in (checkbox). */
async function subscribe({ email, listId = process.env.KLAVIYO_LIST_ID, source = "WiserShifts website" }) {
  if (!listId) throw new Error("KLAVIYO_LIST_ID is not set");
  await client().post("/profile-subscription-bulk-create-jobs", {
    data: {
      type: "profile-subscription-bulk-create-job",
      attributes: {
        custom_source: source,
        profiles: {
          data: [{ type: "profile", attributes: { email, subscriptions: { email: { marketing: { consent: "SUBSCRIBED" } } } } }],
        },
      },
      relationships: { list: { data: { type: "list", id: listId } } },
    },
  });
}

/**
 * Stop (or restart) marketing email to these addresses in Klaviyo. This is
 * Klaviyo's suppression: the profile stays, nothing more is sent to it, and
 * it can be undone. Up to 100 addresses per call.
 */
async function setSuppressed(emails, suppressed) {
  const list = [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    const type = suppressed ? "profile-suppression-bulk-create-job" : "profile-suppression-bulk-delete-job";
    await client().post(suppressed ? "/profile-suppression-bulk-create-jobs" : "/profile-suppression-bulk-delete-jobs", {
      data: { type, attributes: { profiles: { data: chunk.map((email) => ({ type: "profile", attributes: { email } })) } } },
    });
  }
  return list.length;
}

/**
 * Everything for one calculator lead, best effort. Returns { synced, error }.
 */
async function sendLead(lead) {
  if (!isConfigured()) return { synced: false, error: "not_configured" };
  try {
    await upsertProfile({
      email: lead.email,
      organization: lead.company,
      properties: { "WiserShifts Source": lead.source, ...(lead.utm ? { "First UTM": lead.utm } : {}) },
    });
    await trackEvent({
      email: lead.email,
      metric: "Used Calculator",
      properties: { Calculator: lead.source, Summary: lead.summary, Company: lead.company },
    });
    if (lead.newsletter) await subscribe({ email: lead.email, source: lead.source });
    return { synced: true, error: "" };
  } catch (err) {
    return { synced: false, error: errText(err).slice(0, 300) };
  }
}

// ── Reads (HQ email signals) ────────────────────────────────────────────────
async function metricIdByName(name) {
  const res = await client().get("/metrics", { params: { "filter": `equals(name,"${name}")` } }).catch(() => null);
  // Older API versions ignore the filter; match by name ourselves.
  const list = res?.data?.data || [];
  const hit = list.find((m) => m.attributes?.name === name) || null;
  if (hit) return hit.id;
  const all = await client().get("/metrics");
  return (all.data?.data || []).find((m) => m.attributes?.name === name)?.id || null;
}

/** Pages through events for one metric after `since`. Yields { email, at, props }. */
async function* eventsSince(metricId, since, { maxPages = 150 } = {}) {
  let url = "/events";
  let params = {
    filter: `equals(metric_id,"${metricId}"),greater-than(datetime,${since.toISOString()})`,
    include: "profile",
    "fields[profile]": "email",
    sort: "datetime",
    "page[size]": 200,
  };
  for (let page = 0; page < maxPages && url; page += 1) {
    const res = await client().get(url, params ? { params } : undefined);
    const emails = new Map((res.data?.included || []).map((p) => [p.id, p.attributes?.email]));
    for (const e of res.data?.data || []) {
      const pid = e.relationships?.profile?.data?.id;
      yield {
        email: String(emails.get(pid) || "").toLowerCase(),
        at: new Date(e.attributes?.datetime || e.attributes?.timestamp * 1000),
        props: e.attributes?.event_properties || {},
      };
    }
    const next = res.data?.links?.next;
    url = next ? next.replace(BASE, "") : null;
    params = null;
  }
}

/** Email security scanners click every link; Klaviyo flags many of them. */
const isBotClick = (props = {}) =>
  props["Bot Click"] === true || props["Bot Click"] === "true" || props.$is_bot === true || props["Machine Open"] === true;

/**
 * Pull new Received/Clicked/Unsubscribed events since the last run and add
 * them to HqEmailSignal. Cursor per metric lives in HqSync.
 */
async function syncEmailSignals({ now = new Date(), firstRunDays = 180 } = {}) {
  if (!isConfigured()) return { ok: false, error: "not_configured" };
  const HqSync = require("../../models/hqSyncModel");
  const HqEmailSignal = require("../../models/hqEmailSignalModel");
  await HqSync.updateOne({ key: "klaviyo" }, { $setOnInsert: { key: "klaviyo" } }, { upsert: true });
  // Take the lock (15 minutes) or skip: counts are added up, so running twice would double them.
  const sync = await HqSync.findOneAndUpdate(
    { key: "klaviyo", $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
    { $set: { lockedUntil: new Date(now.getTime() + 15 * 60 * 1000) } },
    { new: true },
  );
  if (!sync) return { ok: false, error: "A sync is already running" };
  sync.lastRunAt = now;
  const cursors = JSON.parse(sync.cursor || "{}");
  const counts = {};
  try {
    const plan = [
      ["received", "Received Email"],
      ["clicked", "Clicked Email"],
      ["unsub", "Unsubscribed from Email Marketing"],
      ["unsubOld", "Unsubscribed"],
    ];
    for (const [kind, name] of plan) {
      const metricId = await metricIdByName(name);
      if (!metricId) continue;
      const since = cursors[kind] ? new Date(cursors[kind]) : new Date(now - firstRunDays * DAY);
      const per = new Map();
      const weekly = {};
      let latest = since;
      for await (const ev of eventsSince(metricId, since)) {
        if (!ev.email) continue;
        if (ev.at > latest) latest = ev.at;
        const wk = weekKey(ev.at);
        const field = kind === "received" ? "delivered" : kind === "clicked" ? (isBotClick(ev.props) ? "bot" : "human") : "unsub";
        weekly[`data.weeks.${wk}.${field}`] = (weekly[`data.weeks.${wk}.${field}`] || 0) + 1;
        const p = per.get(ev.email) || { delivered: 0, human: 0, bot: 0, lastDelivered: null, lastHuman: null, campaigns: new Set(), unsub: false };
        if (kind === "received") {
          p.delivered += 1;
          if (!p.lastDelivered || ev.at > p.lastDelivered) p.lastDelivered = ev.at;
        } else if (kind === "clicked") {
          if (isBotClick(ev.props)) p.bot += 1;
          else {
            p.human += 1;
            const name = String(ev.props.Subject || ev.props["Campaign Name"] || ev.props["Message Name"] || "").slice(0, 120);
            if (!p.lastHuman || ev.at > p.lastHuman) {
              p.lastHuman = ev.at;
              // What they clicked most recently: the email and the link.
              p.lastCampaign = name;
              p.lastUrl = String(ev.props.URL || ev.props.Url || "").slice(0, 300);
              p.lastFlow = Boolean(ev.props.$flow);
            }
            if (name) p.campaigns.add(name);
          }
        } else p.unsub = true;
        per.set(ev.email, p);
      }
      const ops = [...per.entries()].map(([email, p]) => {
        const update = { $inc: { delivered: p.delivered, humanClicks: p.human, botClicks: p.bot }, $setOnInsert: { email } };
        const max = {};
        if (p.lastDelivered) max.lastDeliveredAt = p.lastDelivered;
        if (p.lastHuman) max.lastHumanClickAt = p.lastHuman;
        if (Object.keys(max).length) update.$max = max;
        if (p.campaigns.size) update.$addToSet = { campaignsClicked: { $each: [...p.campaigns] } };
        if (p.unsub) update.$set = { unsubscribed: true };
        return { updateOne: { filter: { email }, update, upsert: true } };
      });
      // Remember the latest real click's email and link (only if it's newer than what we have).
      const lastOps = [...per.entries()]
        .filter(([, p]) => p.lastHuman)
        .map(([email, p]) => ({
          updateOne: {
            filter: { email, $or: [{ lastHumanClickAt: null }, { lastHumanClickAt: { $lte: p.lastHuman } }] },
            update: { $set: { lastClickCampaign: p.lastCampaign || "", lastClickUrl: p.lastUrl || "", lastClickFromFlow: Boolean(p.lastFlow) } },
          },
        }));
      if (lastOps.length) await HqEmailSignal.bulkWrite(lastOps, { ordered: false });
      if (ops.length) await HqEmailSignal.bulkWrite(ops, { ordered: false });
      // Week-by-week totals for HQ's Numbers page.
      if (Object.keys(weekly).length) await HqSync.updateOne({ key: "klaviyo-weekly" }, { $inc: weekly }, { upsert: true });
      // Step 1ms past the newest event so it isn't counted twice.
      cursors[kind] = new Date(latest.getTime() + 1).toISOString();
      counts[kind] = per.size;
    }
    sync.cursor = JSON.stringify(cursors);
    sync.lastOkAt = now;
    sync.error = "";
    sync.data = { counts };
    sync.lockedUntil = null;
    await sync.save();
    return { ok: true, counts };
  } catch (err) {
    sync.error = errText(err).slice(0, 500);
    sync.cursor = JSON.stringify(cursors);
    sync.lockedUntil = null;
    await sync.save();
    return { ok: false, error: sync.error };
  }
}

/**
 * Rebuild the week-by-week email totals from Klaviyo (last `days` days).
 * Runs once on its own when the weekly totals don't exist yet (they started
 * being kept after the first per-person sync).
 */
async function rebuildEmailWeeks({ days = 91, now = new Date() } = {}) {
  if (!isConfigured()) return { ok: false, error: "not_configured" };
  const HqSync = require("../../models/hqSyncModel");
  const since = new Date(now - days * DAY);
  const weeks = {};
  const bump = (wk, field) => {
    weeks[wk] = weeks[wk] || { delivered: 0, human: 0, bot: 0, unsub: 0 };
    weeks[wk][field] += 1;
  };
  for (const [kind, name] of [["received", "Received Email"], ["clicked", "Clicked Email"], ["unsub", "Unsubscribed from Email Marketing"], ["unsub", "Unsubscribed"]]) {
    const metricId = await metricIdByName(name);
    if (!metricId) continue;
    for await (const ev of eventsSince(metricId, since, { maxPages: 300 })) {
      bump(weekKey(ev.at), kind === "received" ? "delivered" : kind === "clicked" ? (isBotClick(ev.props) ? "bot" : "human") : "unsub");
    }
  }
  await HqSync.updateOne({ key: "klaviyo-weekly" }, { $set: { "data.weeks": weeks, lastOkAt: now } }, { upsert: true });
  return { ok: true, weeks: Object.keys(weeks).length };
}

module.exports = { setSuppressed, errText, rebuildEmailWeeks, isConfigured, upsertProfile, trackEvent, subscribe, sendLead, syncEmailSignals, isBotClick, metricIdByName };
