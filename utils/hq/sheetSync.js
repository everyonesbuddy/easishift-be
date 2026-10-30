/**
 * HQ ← Google Sheets: read the CRM / call-list tabs straight from Google and
 * import them (same importer as file uploads). Which tabs to read is saved in
 * HqSync "sheets". Re-syncs only write what the sheet changed (see
 * importCsv.changedFields), so edits made in HQ survive.
 */
const HqSync = require("../../models/hqSyncModel");
const google = require("./google");
const importCsv = require("./importCsv");

const ORDER = ["facilities", "contacts", "activities", "linkedin"];

/** Best guess of what a tab holds, from its name (pure). */
function guessTab(name = "") {
  const tier = String(name).match(/^\s*([1-4])\s/);
  if (tier) return { kind: "facilities", tier: Number(tier[1]) };
  if (/lead\s*bank/i.test(name)) return { kind: "contacts", tier: null };
  if (/outreach/i.test(name)) return { kind: "activities", tier: null };
  if (/linkedin/i.test(name)) return { kind: "linkedin", tier: null };
  return { kind: "", tier: null };
}

function cleanSources(list) {
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 30)
    .map((s) => ({
      spreadsheetId: google.spreadsheetIdFrom(s?.spreadsheetId || s?.url || ""),
      title: String(s?.title || "").slice(0, 200),
      tab: String(s?.tab || "").slice(0, 200),
      kind: importCsv.KINDS.includes(s?.kind) ? s.kind : "",
      tier: [1, 2, 3, 4].includes(Number(s?.tier)) ? Number(s.tier) : null,
    }))
    .filter((s) => s.spreadsheetId && s.tab && s.kind);
}

async function getConfig() {
  const doc = await HqSync.findOne({ key: "sheets" }).lean();
  return { sources: doc?.data?.sources || [], lastResults: doc?.data?.lastResults || null, lastOkAt: doc?.lastOkAt || null, lastRunAt: doc?.lastRunAt || null, error: doc?.error || "" };
}

async function saveSources(sources) {
  const clean = cleanSources(sources);
  await HqSync.updateOne({ key: "sheets" }, { $set: { "data.sources": clean } }, { upsert: true });
  return clean;
}

/** Read every saved tab and import it. dryRun: just count what would come in. */
async function syncSheets({ dryRun = false, by = "HQ sheet sync", now = new Date() } = {}) {
  if (!google.sheetsConfigured()) return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON is not set" };
  await HqSync.updateOne({ key: "sheets" }, { $setOnInsert: { key: "sheets" } }, { upsert: true });
  if (!dryRun) {
    const locked = await HqSync.findOneAndUpdate(
      { key: "sheets", $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + 15 * 60 * 1000), lastRunAt: now } },
      { new: true },
    );
    if (!locked) return { ok: false, error: "A sync is already running" };
  }
  const { sources } = await getConfig();
  const results = [];
  let failed = false;
  const sorted = [...sources].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.tier || 0) - (b.tier || 0));
  for (const s of sorted) {
    const label = `${s.title || "Sheet"} › ${s.tab}`;
    try {
      const rows = await google.sheetRows(s.spreadsheetId, s.tab);
      const n = importCsv.normalize(s.kind, importCsv.rowsToCsv(rows), { defaultTier: s.tier });
      if (!n.matchedColumns.length) {
        results.push({ label, kind: s.kind, error: "No columns recognized on this tab" });
        failed = true;
        continue;
      }
      const r = dryRun ? {} : await importCsv.apply(s.kind, n.rows, { by });
      results.push({ label, kind: s.kind, totalRows: n.totalRows, usable: n.rows.length, ...r });
    } catch (err) {
      failed = true;
      const status = err?.response?.status;
      results.push({
        label,
        kind: s.kind,
        error:
          status === 403 || status === 404
            ? `Can't open it: share the sheet with ${google.serviceAccountEmail()} (Viewer)`
            : google.errText(err).slice(0, 200),
      });
    }
  }
  if (!dryRun) {
    await HqSync.updateOne(
      { key: "sheets" },
      { $set: { lockedUntil: null, "data.lastResults": results, error: failed ? "Some tabs didn't sync" : "", ...(failed ? {} : { lastOkAt: now }) } },
    );
  }
  return { ok: !failed, results };
}

module.exports = { guessTab, cleanSources, getConfig, saveSources, syncSheets };
