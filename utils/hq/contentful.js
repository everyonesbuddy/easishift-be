/**
 * Contentful blog posts (Content Delivery API, read-only).
 *
 * TODO(keys): CONTENTFUL_SPACE_ID, CONTENTFUL_DELIVERY_TOKEN (Contentful →
 *   Settings → API keys → Content delivery / preview tokens → "Content
 *   Delivery API - access token"), CONTENTFUL_ENVIRONMENT (default "master").
 *
 * Content type id: blogPost (see the PR for the fields to create).
 */
const axios = require("axios");

const isConfigured = () => Boolean(process.env.CONTENTFUL_SPACE_ID && process.env.CONTENTFUL_DELIVERY_TOKEN);

async function listPosts({ limit = 100 } = {}) {
  const env = process.env.CONTENTFUL_ENVIRONMENT || "master";
  const res = await axios.get(
    `https://cdn.contentful.com/spaces/${process.env.CONTENTFUL_SPACE_ID}/environments/${env}/entries`,
    {
      params: {
        content_type: "blogPost",
        order: "-fields.publishDate",
        limit,
        select: "sys.id,sys.updatedAt,fields.title,fields.slug,fields.excerpt,fields.audience,fields.publishDate",
      },
      headers: { Authorization: `Bearer ${process.env.CONTENTFUL_DELIVERY_TOKEN}` },
      timeout: 15000,
    },
  );
  return (res.data.items || []).map((e) => ({
    id: e.sys.id,
    title: e.fields?.title || "",
    slug: e.fields?.slug || "",
    excerpt: e.fields?.excerpt || "",
    audience: e.fields?.audience || [],
    publishDate: e.fields?.publishDate || null,
    updatedAt: e.sys.updatedAt,
  }));
}

module.exports = { isConfigured, listPosts };
