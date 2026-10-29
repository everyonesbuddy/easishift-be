/**
 * HQ content plan: every piece (video, post, newsletter, template…) from idea
 * to published, and how each published piece did, matched by its link to
 * YouTube, Google Analytics or the LinkedIn export.
 */
const mongoose = require("mongoose");
const HqContentItem = require("../models/hqContentItemModel");
const HqSync = require("../models/hqSyncModel");
const HqLinkedinPost = require("../models/hqLinkedinPostModel");
const { ensureSeeded } = require("./hqPlaybookController");

const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ""));
const FIELDS = ["title", "format", "channel", "audience", "status", "dueDate", "publishedAt", "url", "owner", "notes", "playId"];

function clean(b) {
  const out = Object.fromEntries(FIELDS.filter((f) => b?.[f] !== undefined).map((f) => [f, b[f]]));
  if (out.playId !== undefined && !isId(out.playId)) out.playId = null;
  for (const d of ["dueDate", "publishedAt"]) if (out[d] !== undefined) out[d] = out[d] ? new Date(out[d]) : null;
  if (out.status === "published" && out.publishedAt === undefined) out.publishedAt = new Date();
  return out;
}

const youtubeId = (url = "") => (String(url).match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/) || [])[1] || "";
const pathOf = (url = "") => {
  try {
    return new URL(url).pathname.replace(/\/$/, "") || "/";
  } catch {
    return "";
  }
};
const normLi = (url = "") => String(url).split("?")[0].replace(/\/$/, "").toLowerCase();

/** Numbers for one published piece, from the cached reports (pure). */
function metricsFor(item, { videos = [], pages = [], linkedin = [] }) {
  if (!item.url) return null;
  const yt = youtubeId(item.url);
  if (yt) {
    const v = videos.find((x) => x.id === yt);
    return v ? { source: "YouTube", views: v.views, likes: v.likes, comments: v.comments } : { source: "YouTube", pending: true };
  }
  if (/linkedin\.com/i.test(item.url)) {
    const p = linkedin.find((x) => normLi(x.url) === normLi(item.url));
    return p ? { source: "LinkedIn", impressions: p.impressions, engagement: p.reactions + p.comments + p.reposts } : { source: "LinkedIn", pending: true };
  }
  const path = pathOf(item.url);
  if (path && /wisershifts\.com/i.test(item.url)) {
    const views = pages.filter((p) => p.pagePath === path || p.pagePath === `${path}/`).reduce((s, p) => s + p.screenPageViews, 0);
    return { source: "Website (28 days)", views };
  }
  return null;
}

exports.listItems = async (req, res, next) => {
  try {
    await ensureSeeded();
    const [items, video, web, linkedin] = await Promise.all([
      HqContentItem.find({}).sort({ dueDate: 1, createdAt: -1 }).lean(),
      HqSync.findOne({ key: "video" }).select("data").lean(),
      HqSync.findOne({ key: "web" }).select("data").lean(),
      HqLinkedinPost.find({}).lean(),
    ]);
    const sources = { videos: video?.data?.videos || [], pages: web?.data?.pages || [], linkedin };
    res.json({ items: items.map((i) => ({ ...i, metrics: i.status === "published" ? metricsFor(i, sources) : null })) });
  } catch (err) {
    next(err);
  }
};

exports.createItem = async (req, res, next) => {
  try {
    const body = clean(req.body);
    if (!String(body.title || "").trim()) return res.status(400).json({ message: "Give it a title" });
    const item = await HqContentItem.create(body);
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
};

exports.updateItem = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: "Not found" });
    const item = await HqContentItem.findByIdAndUpdate(req.params.id, { $set: clean(req.body) }, { new: true, runValidators: true }).lean();
    if (!item) return res.status(404).json({ message: "Not found" });
    res.json({ item });
  } catch (err) {
    next(err);
  }
};

exports.deleteItem = async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return res.status(404).json({ message: "Not found" });
    await HqContentItem.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

module.exports.metricsFor = metricsFor;
module.exports.youtubeId = youtubeId;
