/**
 * HQ: pull new federal listings from SAM.gov's public Get Opportunities API
 * (needs SAM_GOV_API_KEY, from your SAM.gov Account Details page). Runs once
 * a day; new matches land on HQ's Government page as "New".
 */
const axios = require("axios");
const HqGovListing = require("../../models/hqGovListingModel");
const HqSync = require("../../models/hqSyncModel");
const gov = require("./gov");

const URL = "https://api.sam.gov/opportunities/v2/search";
const KEY = "gov-sam";

const isConfigured = () => Boolean(process.env.SAM_GOV_API_KEY);

async function state() {
  const s = await HqSync.findOne({ key: KEY }).lean();
  return s?.data || {};
}

/** One search, every page (1000 at a time). */
async function search(params, get = axios.get) {
  const out = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const { data } = await get(URL, { params: { api_key: process.env.SAM_GOV_API_KEY, limit: 1000, offset, ...params }, timeout: 30000 });
    const page = data?.opportunitiesData || [];
    out.push(...page);
    if (page.length < 1000 || out.length >= Number(data?.totalRecords || 0)) break;
  }
  return out;
}

/** Plain words for what went wrong, without the key. */
function why(err) {
  const s = err?.response?.status;
  if (s === 401 || s === 403) return "SAM.gov refused the API key. Check SAM_GOV_API_KEY (Account Details on SAM.gov).";
  if (s === 429) return "SAM.gov's daily request limit is used up. It'll try again tomorrow.";
  return `SAM.gov didn't answer (${s || err?.code || "network error"}).`;
}

/**
 * Pull listings posted since the last pull and save the ones for us.
 * Returns { ok, found, added } or { ok: false, error }.
 */
async function fetchNew({ now = new Date(), get } = {}) {
  if (!isConfigured()) return { ok: false, error: "Add SAM_GOV_API_KEY to turn on the federal feed." };
  const prev = await state();
  const win = gov.window(prev.lastFetchAt, now);
  const seen = new Map();
  try {
    for (const s of gov.SEARCHES) {
      const { why: label, ...params } = s;
      for (const o of await search({ ...params, ...win }, get)) {
        const l = gov.fromSam(o, label);
        if (l && !seen.has(l.noticeId)) seen.set(l.noticeId, l);
      }
    }
  } catch (err) {
    const error = why(err);
    await HqSync.updateOne({ key: KEY }, { $set: { "data.lastError": error, "data.lastTriedAt": now } }, { upsert: true });
    return { ok: false, error };
  }
  let added = 0;
  for (const l of seen.values()) {
    const { noticeId, matched, title, dueAt, noticeType, url, ...rest } = l;
    // New ones start as "New"; ones already here get the latest dates and title, and keep your status and notes.
    // (A field can't be in both $set and $setOnInsert, so the ones that refresh are only in $set.)
    const r = await HqGovListing.updateOne(
      { noticeId },
      { $set: { title, dueAt, noticeType, url }, $setOnInsert: { ...rest, noticeId, matched, status: "new", statusAt: now } },
      { upsert: true },
    );
    if (r.upsertedCount) added += 1;
  }
  await HqSync.updateOne({ key: KEY }, { $set: { data: { lastFetchAt: now, lastTriedAt: now, lastError: "", lastAdded: added, lastFound: seen.size } } }, { upsert: true });
  return { ok: true, found: seen.size, added };
}

module.exports = { isConfigured, fetchNew, state, search };
