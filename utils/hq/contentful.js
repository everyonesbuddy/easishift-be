/**
 * Contentful blog posts (Content Delivery API, read-only). Used by the public
 * blog on the website (/api/v1/public/blog) and by HQ's Content tab.
 *
 * TODO(keys): CONTENTFUL_SPACE_ID, CONTENTFUL_DELIVERY_TOKEN (Contentful →
 *   Settings → API keys → Add API key → "Content Delivery API - access
 *   token"), CONTENTFUL_ENVIRONMENT (default "master").
 *
 * Content type id: blogPost by default; set CONTENTFUL_CONTENT_TYPE if yours
 * is different (e.g. wisershiftsBlogPost). Fields: title (Short text), slug (Short text,
 * unique), excerpt (Long text), body (Rich text), coverImage (Media),
 * audience (Short text, list: schedulers / directors / operators),
 * publishDate (Date), author (Short text), seoDescription (Short text).
 */
const axios = require("axios");

const isConfigured = () => Boolean(process.env.CONTENTFUL_SPACE_ID && process.env.CONTENTFUL_DELIVERY_TOKEN);

const get = (params) =>
  axios
    .get(
      `https://cdn.contentful.com/spaces/${process.env.CONTENTFUL_SPACE_ID}/environments/${process.env.CONTENTFUL_ENVIRONMENT || "master"}/entries`,
      { params: { content_type: process.env.CONTENTFUL_CONTENT_TYPE || "blogPost", ...params }, headers: { Authorization: `Bearer ${process.env.CONTENTFUL_DELIVERY_TOKEN}` }, timeout: 15000 },
    )
    .then((r) => r.data);

const assetMap = (data) =>
  new Map(
    (data.includes?.Asset || []).map((a) => [
      a.sys.id,
      {
        url: a.fields?.file?.url ? `https:${a.fields.file.url}` : "",
        title: a.fields?.title || "",
        width: a.fields?.file?.details?.image?.width || null,
        height: a.fields?.file?.details?.image?.height || null,
        // Files (a PDF or Excel template) are shown as downloads, not images.
        contentType: a.fields?.file?.contentType || "",
        fileName: a.fields?.file?.fileName || "",
        size: a.fields?.file?.details?.size || null,
      },
    ]),
  );

const summary = (e, assets) => ({
  id: e.sys.id,
  title: e.fields?.title || "",
  slug: e.fields?.slug || "",
  excerpt: e.fields?.excerpt || "",
  audience: e.fields?.audience || [],
  publishDate: e.fields?.publishDate || e.sys.createdAt,
  author: e.fields?.author || "",
  coverImage: e.fields?.coverImage?.sys?.id ? assets.get(e.fields.coverImage.sys.id) || null : null,
  updatedAt: e.sys.updatedAt,
});

async function listPosts({ limit = 100 } = {}) {
  const data = await get({ order: "-fields.publishDate", limit, include: 1, select: "sys.id,sys.createdAt,sys.updatedAt,fields.title,fields.slug,fields.excerpt,fields.audience,fields.publishDate,fields.author,fields.coverImage" });
  const assets = assetMap(data);
  return (data.items || []).map((e) => summary(e, assets));
}

/** One post with its rich-text body; embedded images resolved to { url, title }. */
async function getPost(slug) {
  const data = await get({ "fields.slug": slug, limit: 1, include: 2 });
  const e = data.items?.[0];
  if (!e) return null;
  const assets = assetMap(data);
  return {
    ...summary(e, assets),
    seoDescription: e.fields?.seoDescription || e.fields?.excerpt || "",
    body: e.fields?.body || null,
    assets: Object.fromEntries(assets),
  };
}

module.exports = { isConfigured, listPosts, getPost };
