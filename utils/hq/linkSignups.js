/**
 * HQ: connect each signed-up workspace to a facility on our list (by email
 * domain or building name), or add it to the list as a new facility.
 */
const { domainOf } = require("./domain");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Pure: best facility for a workspace, or null. */
function matchFacility(workspace, facilities) {
  const d = domainOf(workspace.ownerEmail || workspace.email);
  const n = norm(workspace.name);
  const free = facilities.filter((f) => !f.tenantId);
  if (n) {
    const byName = free.find((f) => norm(f.name) === n);
    if (byName) return byName;
  }
  if (d) {
    const byDomain = free.filter((f) => f.domain === d);
    // One building with that domain: it's them. Several (a group site): only if the name is close.
    if (byDomain.length === 1) return byDomain[0];
    const close = byDomain.find((f) => n && (norm(f.name).includes(n) || n.includes(norm(f.name))));
    if (close) return close;
  }
  return null;
}

async function linkSignups(workspaces) {
  const HqFacility = require("../../models/hqFacilityModel");
  const linked = new Set((await HqFacility.find({ tenantId: { $ne: null } }).select("tenantId").lean()).map((f) => String(f.tenantId)));
  const todo = workspaces.filter((w) => !linked.has(String(w.tenantId)));
  if (!todo.length) return { linked: 0, created: 0 };
  const facilities = await HqFacility.find({ tenantId: null }).select("name domain tenantId").lean();
  let linkedN = 0;
  let created = 0;
  const HqContact = require("../../models/hqContactModel");
  for (const w of todo) {
    const hit = matchFacility(w, facilities);
    let facilityId;
    if (hit) {
      await HqFacility.updateOne({ _id: hit._id, tenantId: null }, { $set: { tenantId: w.tenantId } });
      hit.tenantId = w.tenantId;
      facilityId = hit._id;
      linkedN += 1;
    } else {
      const f = await HqFacility.create({
        name: w.name,
        facilityType: w.facilityType,
        domain: domainOf(w.ownerEmail || w.email),
        tenantId: w.tenantId,
        source: "signup",
      });
      facilityId = f._id;
      created += 1;
    }
    // The person who signed up becomes a contact (kept as-is if we already have them).
    if (w.ownerEmail) {
      await HqContact.updateOne(
        { email: String(w.ownerEmail).toLowerCase() },
        {
          $setOnInsert: {
            name: w.ownerName,
            email: String(w.ownerEmail).toLowerCase(),
            role: HqContact.ROLES.includes(w.signupRole) ? w.signupRole : "other",
            facilityId,
            facilityName: w.name,
            source: "signup",
          },
        },
        { upsert: true },
      );
    }
  }
  return { linked: linkedN, created };
}

module.exports = { matchFacility, linkSignups };
