/**
 * Workspaces tagged as not real (tests, app-store reviewers, demos). HQ
 * counts and looks after real customers only; these helpers say which to
 * leave out.
 */
const KINDS = {
  real: "Real",
  test: "Test account",
  app_review: "App review",
  demo: "Demo",
  other: "Not a customer",
};

async function tagMap() {
  const HqWorkspaceTag = require("../../models/hqWorkspaceTagModel");
  const tags = (await HqWorkspaceTag.find({}).select("tenantId kind note").lean()) || [];
  return new Map(tags.map((t) => [String(t.tenantId), t]));
}

/** Tenant ids to leave out (as stored, for $nin). */
async function taggedIds() {
  const HqWorkspaceTag = require("../../models/hqWorkspaceTagModel");
  return ((await HqWorkspaceTag.find({}).select("tenantId").lean()) || []).map((t) => t.tenantId);
}

/** Add "not one of the tagged workspaces" to a Tenant query. */
async function realOnly(query = {}) {
  const ids = await taggedIds();
  if (!ids.length) return query;
  return query._id === undefined ? { ...query, _id: { $nin: ids } } : { $and: [query, { _id: { $nin: ids } }] };
}

module.exports = { KINDS, tagMap, taggedIds, realOnly };
