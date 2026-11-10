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

const TIMEOUT_MS = 90000; // SAM.gov can be slow; one search gets up to 90 seconds a page
const SLOW = new Set(["ECONNABORTED", "ETIMEDOUT", "ECONNRESET"]);

/** One search, every page (1000 at a time). A timeout is tried once more. */
async function search(params, get = axios.get) {
  const out = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const req = () => get(URL, { params: { api_key: process.env.SAM_GOV_API_KEY, limit: 1000, offset, ...params }, timeout: TIMEOUT_MS });
    let res;
    try {
      res = await req();
    } catch (err) {
      if (!SLOW.has(err?.code)) throw err;
      res = await req();
    }
    const page = res.data?.opportunitiesData || [];
    out.push(...page);
    if (page.length < 1000 || out.length >= Number(res.data?.totalRecords || 0)) break;
  }
  return out;
}

/** Plain words for what went wrong, without the key. */
function why(err) {
  const s = err?.response?.status;
  if (s === 401 || s === 403) return "SAM.gov refused the API key. Check SAM_GOV_API_KEY (Account Details on SAM.gov).";
  if (s === 429) return "SAM.gov's daily request limit is used up. It'll try again tomorrow.";
  if (SLOW.has(err?.code)) return "SAM.gov was too slow to answer";
  return `SAM.gov didn't answer (${s || err?.code || "network error"})`;
}
// A refused key or a used-up limit stops every search; anything else skips just that one.
const stopsAll = (err) => [401, 403, 429].includes(err?.response?.status);

/**
 * Pull listings posted since the last pull and save the ones for us. Each
 * search stands alone: a slow one is skipped and the rest are saved. The
 * window only moves forward when every search answered, so a skipped one is
 * covered next time. Returns { ok, found, added, failed } or { ok: false, error }.
 */
async function fetchNew({ now = new Date(), get } = {}) {
  if (!isConfigured()) return { ok: false, error: "Add SAM_GOV_API_KEY to turn on the federal feed." };
  const prev = await state();
  const win = gov.window(prev.lastFetchAt, now);
  const seen = new Map();
  const failed = [];
  for (const s of gov.SEARCHES) {
    const { why: label, ...params } = s;
    try {
      for (const o of await search({ ...params, ...win }, get)) {
        const l = gov.fromSam(o, label);
        if (l && !seen.has(l.noticeId)) seen.set(l.noticeId, l);
      }
    } catch (err) {
      failed.push({ label, error: why(err) });
      if (stopsAll(err)) break;
    }
  }
  // Nothing came back: every search failed, or the key or daily limit stopped them all.
  const stopped = failed.find((f) => /refused|limit/.test(f.error));
  if (failed.length && !seen.size && (stopped || failed.length === gov.SEARCHES.length)) {
    const error = stopped ? stopped.error : `${failed[0].error}. It'll try again tomorrow, or press Check now.`;
    await HqSync.updateOne({ key: KEY }, { $set: { "data.lastError": error, "data.lastTriedAt": now } }, { upsert: true });
    return { ok: false, error, failed };
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
  const lastError = failed.length ? `${failed.length} of ${gov.SEARCHES.length} searches didn't finish (${failed.map((f) => f.label).join(", ")}): ${failed[0].error.toLowerCase()}. The rest are saved; those get another try next time.` : "";
  await HqSync.updateOne(
    { key: KEY },
    { $set: { data: { lastFetchAt: failed.length ? prev.lastFetchAt || null : now, lastTriedAt: now, lastError, lastAdded: added, lastFound: seen.size } } },
    { upsert: true },
  );
  return { ok: true, found: seen.size, added, failed };
}

// One pull at a time in this server; "Check now" and the morning job share it.
let running = null;
/** Start a pull (or join the one running) without waiting for it. */
function start(opts) {
  if (!running) running = fetchNew(opts).finally(() => (running = null));
  return running;
}
const isRunning = () => Boolean(running);

module.exports = { isConfigured, fetchNew, start, isRunning, state, search };
