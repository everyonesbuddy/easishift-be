/**
 * Public blog (posts live in Contentful). Cached in memory for 5 minutes so
 * the website is fast and we stay well under Contentful's limits.
 */
const contentful = require("../utils/hq/contentful");

const TTL = 5 * 60 * 1000;
const cache = new Map();
const cached = async (key, load) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
};

exports.listPosts = async (req, res) => {
  if (!contentful.isConfigured()) return res.json({ posts: [], configured: false });
  try {
    const posts = await cached("list", () => contentful.listPosts());
    const audience = String(req.query.audience || "");
    res.set("Cache-Control", "public, max-age=300");
    res.json({ posts: audience ? posts.filter((p) => p.audience.includes(audience)) : posts, configured: true });
  } catch (err) {
    console.error("Blog list failed:", err?.message);
    res.status(502).json({ message: "The blog is unavailable right now." });
  }
};

exports.getPost = async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return res.status(404).json({ message: "Not found" });
  if (!contentful.isConfigured()) return res.status(404).json({ message: "Not found" });
  try {
    const post = await cached(`post:${slug}`, () => contentful.getPost(slug));
    if (!post) return res.status(404).json({ message: "Not found" });
    res.set("Cache-Control", "public, max-age=300");
    res.json({ post });
  } catch (err) {
    console.error("Blog post failed:", err?.message);
    res.status(502).json({ message: "The blog is unavailable right now." });
  }
};
