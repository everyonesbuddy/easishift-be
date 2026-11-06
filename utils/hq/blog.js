/**
 * The blog campaign and the real blog: posts published in Contentful count
 * toward it, and a saved idea that's already been published (same title,
 * give or take a few words) isn't a to-do any more.
 */
const BLOG_KEY = "search-templates";
const STOP = new Set(["the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "with", "how", "your", "you", "free", "what", "is", "it", "pdf", "excel"]);
const words = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w)));

/** Two titles name the same piece if most words of the shorter one are in the other. */
function sameTitle(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  let hit = 0;
  for (const w of small) if (big.has(w)) hit += 1;
  return hit / small.size >= 0.8 && hit >= 2;
}

const isBlogPlay = (p) => p?.seedKey === BLOG_KEY;
const postUrl = (p) => (p.slug ? `https://wisershifts.com/blog/${p.slug}` : "");
const postDate = (p) => new Date(p.publishDate || p.createdAt || 0);

/** Posts published in [from, to), newest first, as { title, url, date }. */
function postsIn(posts, from, to) {
  return (posts || [])
    .filter((p) => {
      const d = postDate(p);
      return d >= from && d < to;
    })
    .sort((a, b) => postDate(b) - postDate(a))
    .map((p) => ({ title: p.title, url: postUrl(p), date: postDate(p) }));
}

/** Posts to count for the campaign: ones not already counted as a published HQ piece with the same title. */
function uncounted(posts, published) {
  return (posts || []).filter((p) => !(published || []).some((c) => sameTitle(c.title, p.title)));
}

module.exports = { BLOG_KEY, sameTitle, isBlogPlay, postsIn, postUrl, postDate, uncounted };
