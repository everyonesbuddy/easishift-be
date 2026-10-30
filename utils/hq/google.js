/**
 * Google Analytics 4 + Search Console, read-only, through one service account.
 * No Google SDK: we sign the service-account JWT ourselves and trade it for
 * an access token.
 *
 * TODO(keys): GOOGLE_SERVICE_ACCOUNT_JSON  the whole JSON key file of a
 *   service account (Google Cloud → IAM → Service accounts → Keys → JSON),
 *   pasted as one line. Enable "Google Analytics Data API" and "Google Search
 *   Console API" in that Cloud project.
 * TODO(keys): GA4_PROPERTY_ID  numeric property id (GA → Admin → Property
 *   details). Add the service account's email as a Viewer on the property.
 * Google Sheets (CRM sync): enable "Google Sheets API" in the same Cloud
 *   project and share each spreadsheet with the service account's email
 *   (Viewer is enough). No extra key.
 * TODO(keys): GSC_SITE_URL  exactly as Search Console shows it, e.g.
 *   "sc-domain:wisershifts.com" or "https://www.wisershifts.com/". Add the
 *   service account's email as a user (Restricted is enough) on the property.
 */
const crypto = require("crypto");
const axios = require("axios");

const SCOPES = {
  ga: "https://www.googleapis.com/auth/analytics.readonly",
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
  sheets: "https://www.googleapis.com/auth/spreadsheets.readonly",
};

const credentials = () => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const json = JSON.parse(raw);
    if (!json.client_email || !json.private_key) return null;
    return { email: json.client_email, key: json.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
};

const sheetsConfigured = () => Boolean(credentials());
const serviceAccountEmail = () => credentials()?.email || "";

/** "https://docs.google.com/spreadsheets/d/<id>/edit…" or a bare id → id. */
const spreadsheetIdFrom = (value = "") => {
  const s = String(value).trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : "";
};

async function sheetTabs(spreadsheetId) {
  const token = await accessToken(SCOPES.sheets);
  const res = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    params: { fields: "properties.title,sheets.properties.title" },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
  });
  return { title: res.data.properties?.title || "", tabs: (res.data.sheets || []).map((x) => x.properties.title) };
}

/**
 * One tab as rows of strings: what you see in each cell, except link cells
 * (=HYPERLINK) keep their formula so the URL isn't lost.
 */
async function sheetRows(spreadsheetId, tab) {
  const token = await accessToken(SCOPES.sheets);
  const range = `'${String(tab).replace(/'/g, "''")}'`;
  const get = (valueRenderOption) =>
    axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
      params: { valueRenderOption, dateTimeRenderOption: "FORMATTED_STRING" },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    });
  const [shown, formulas] = await Promise.all([get("FORMATTED_VALUE"), get("FORMULA")]);
  const f = formulas.data.values || [];
  return (shown.data.values || []).map((row, i) =>
    row.map((cell, j) => {
      const raw = f[i]?.[j];
      return typeof raw === "string" && /^=\s*HYPERLINK\(/i.test(raw) ? raw : cell;
    }),
  );
}

const gaConfigured = () => Boolean(credentials() && process.env.GA4_PROPERTY_ID);
const gscConfigured = () => Boolean(credentials() && process.env.GSC_SITE_URL);

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

function signJwt({ email, key }, scope, now = Math.floor(Date.now() / 1000)) {
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const claim = b64url({ iss: email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const signature = crypto.createSign("RSA-SHA256").update(`${header}.${claim}`).sign(key).toString("base64url");
  return `${header}.${claim}.${signature}`;
}

const tokenCache = new Map();
async function accessToken(scope) {
  const hit = tokenCache.get(scope);
  if (hit && hit.expires > Date.now() + 60000) return hit.token;
  const creds = credentials();
  if (!creds) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set or invalid");
  const assertion = signJwt(creds, scope);
  const res = await axios.post(
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
    { headers: { "content-type": "application/x-www-form-urlencoded" }, timeout: 15000 },
  );
  tokenCache.set(scope, { token: res.data.access_token, expires: Date.now() + (res.data.expires_in || 3600) * 1000 });
  return res.data.access_token;
}

const errText = (err) => err?.response?.data?.error?.message || err?.response?.data?.error_description || err?.message || "Google error";

/** Rows from a GA4 report as plain objects keyed by dimension/metric name. */
async function ga4Report({ dimensions = [], metrics = [], days = 28, limit = 50, orderBy = null, dimensionFilter = null }) {
  const token = await accessToken(SCOPES.ga);
  const res = await axios.post(
    `https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`,
    {
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
      dimensions: dimensions.map((name) => ({ name })),
      metrics: metrics.map((name) => ({ name })),
      limit,
      ...(orderBy ? { orderBys: [orderBy] } : {}),
      ...(dimensionFilter ? { dimensionFilter } : {}),
    },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 },
  );
  return (res.data.rows || []).map((r) => {
    const o = {};
    dimensions.forEach((d, i) => (o[d] = r.dimensionValues?.[i]?.value ?? ""));
    metrics.forEach((m, i) => (o[m] = Number(r.metricValues?.[i]?.value ?? 0)));
    return o;
  });
}

/** Website: totals, by day, top pages, sources, and key events (sign_up). */
async function webSummary({ days = 28 } = {}) {
  const [totals, byDay, pages, sources, events] = await Promise.all([
    ga4Report({ metrics: ["activeUsers", "sessions", "engagedSessions"], days }),
    ga4Report({ dimensions: ["date"], metrics: ["activeUsers", "sessions"], days, limit: 100, orderBy: { dimension: { dimensionName: "date" } } }),
    ga4Report({ dimensions: ["pagePath"], metrics: ["screenPageViews", "activeUsers"], days, limit: 25, orderBy: { metric: { metricName: "screenPageViews" }, desc: true } }),
    ga4Report({ dimensions: ["sessionSource", "sessionMedium"], metrics: ["sessions", "activeUsers"], days, limit: 15, orderBy: { metric: { metricName: "sessions" }, desc: true } }),
    ga4Report({ dimensions: ["eventName"], metrics: ["eventCount"], days, limit: 25, orderBy: { metric: { metricName: "eventCount" }, desc: true } }),
  ]);
  return { days, totals: totals[0] || {}, byDay, pages, sources, events };
}

/** Visitors per day for the last `days` days (for week-by-week numbers). */
async function webDaily({ days = 84 } = {}) {
  return ga4Report({ dimensions: ["date"], metrics: ["activeUsers", "sessions"], days, limit: 400, orderBy: { dimension: { dimensionName: "date" } } });
}

/** Search Console: totals, top queries and top pages. */
async function searchSummary({ days = 28 } = {}) {
  const token = await accessToken(SCOPES.gsc);
  const end = new Date(Date.now() - 2 * 86400000); // GSC lags ~2 days
  const start = new Date(end - days * 86400000);
  const ymd = (d) => d.toISOString().slice(0, 10);
  const query = (dimensions, rowLimit = 25) =>
    axios
      .post(
        `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(process.env.GSC_SITE_URL)}/searchAnalytics/query`,
        { startDate: ymd(start), endDate: ymd(end), dimensions, rowLimit },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 },
      )
      .then((r) =>
        (r.data.rows || []).map((row) => ({
          ...(dimensions.length ? Object.fromEntries(dimensions.map((d, i) => [d, row.keys[i]])) : {}),
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        })),
      );
  const [totals, queries, pages, byDay] = await Promise.all([query([], 1), query(["query"]), query(["page"]), query(["date"], 100)]);
  return { days, from: ymd(start), to: ymd(end), totals: totals[0] || { clicks: 0, impressions: 0 }, queries, pages, byDay };
}

module.exports = {
  gaConfigured,
  gscConfigured,
  sheetsConfigured,
  serviceAccountEmail,
  spreadsheetIdFrom,
  sheetTabs,
  sheetRows,
  webSummary,
  webDaily,
  searchSummary,
  signJwt,
  errText,
};
