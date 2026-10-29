/** HQ: sync the CRM and call list straight from Google Sheets. */
const google = require("../utils/hq/google");
const sheetSync = require("../utils/hq/sheetSync");

const by = (req) => req.hqUser?.name || req.hqUser?.email || "";

exports.getSheets = async (req, res, next) => {
  try {
    const config = await sheetSync.getConfig();
    res.json({ configured: google.sheetsConfigured(), serviceAccountEmail: google.serviceAccountEmail(), ...config });
  } catch (err) {
    next(err);
  }
};

/** Look inside a spreadsheet: its tabs, each with a guess of what it holds. */
exports.listTabs = async (req, res) => {
  const spreadsheetId = google.spreadsheetIdFrom(req.body?.url);
  if (!spreadsheetId) return res.status(400).json({ message: "Paste the Google Sheet's link" });
  if (!google.sheetsConfigured()) return res.status(400).json({ message: "Google isn't connected yet (GOOGLE_SERVICE_ACCOUNT_JSON)." });
  try {
    const { title, tabs } = await google.sheetTabs(spreadsheetId);
    res.json({ spreadsheetId, title, tabs: tabs.map((name) => ({ name, ...sheetSync.guessTab(name) })) });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 403 || status === 404) {
      return res.status(400).json({ message: `Can't open that sheet. Share it with ${google.serviceAccountEmail()} (Viewer), then try again.` });
    }
    res.status(502).json({ message: google.errText(err) });
  }
};

exports.saveSheets = async (req, res, next) => {
  try {
    const sources = await sheetSync.saveSources(req.body?.sources);
    res.json({ sources });
  } catch (err) {
    next(err);
  }
};

exports.syncSheets = async (req, res, next) => {
  try {
    const result = await sheetSync.syncSheets({ dryRun: req.body?.dryRun === true, by: by(req) });
    if (result.error) return res.status(400).json({ message: result.error });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
