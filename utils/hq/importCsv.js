/**
 * HQ imports from CSV (save each spreadsheet tab as CSV):
 *  - facilities: the cold-call tier sheets (Call ID, Building, City, …)
 *  - contacts:   CRM "Lead Bank" (Lead ID, Contact Name, Contact Title, …)
 *  - activities: CRM "Outreach" (Lead ID, Call Date, Call Outcome, …)
 *  - linkedin:   LinkedIn post analytics export
 * Re-importing the same file updates rows (matched by Call ID / Lead ID / URL).
 *
 * normalize() is pure (tested); apply() writes.
 */
const { parse } = require("csv-parse/sync");
const { roleFromTitle } = require("./roles");
const { domainOf } = require("./domain");

const KINDS = ["facilities", "contacts", "activities", "linkedin"];
const key = (h) => String(h || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]/g, "");

// field -> header aliases (already key()-normalized)
const ALIASES = {
  facilities: {
    ref: ["callid", "id", "ref"],
    leadRef: ["oldleadid", "leadid"],
    oldHistory: ["oldcrmhistory"],
    tier: ["tier"],
    score: ["score"],
    whyTier: ["whythistier", "why"],
    name: ["building", "facility", "facilityname", "name"],
    city: ["city"],
    state: ["state", "st"],
    timeZone: ["timezone", "tz"],
    frontDeskPhone: ["frontdeskphone", "phone", "mainphone"],
    group: ["group", "ownershipgroup", "company", "ownershipgroupcompany"],
    buildingsInGroup: ["buildingsingroup", "totalfacilitiesingroup", "facilitiesingroup"],
    website: ["groupwebsite", "website", "url"],
    stage: ["stage", "status"],
    attempts: ["attempts"],
    lastCallDate: ["lastcalldate", "lastcall"],
    nextStep: ["nextstep"],
    nextDate: ["nextdate"],
    schedulerName: ["schedulername"],
    schedulerTitle: ["schedulertitle"],
    schedulerEmail: ["scheduleremail"],
    schedulerPhone: ["schedulerdirectlineext", "schedulerdirectline", "schedulerphone"],
    currentTool: ["currenttool"],
    biggestPain: ["biggestpain"],
    facilityType: ["facilitytype", "type"],
    notes: ["notes"],
  },
  contacts: {
    ref: ["leadid", "id", "ref"],
    group: ["ownershipgroupcompany", "ownershipgroup", "company", "group"],
    facilityName: ["facilityentrypoint", "facility", "building"],
    buildingsInGroup: ["totalfacilitiesingroup", "buildingsingroup"],
    name: ["contactname", "name"],
    title: ["contacttitle", "title"],
    email: ["contactemail", "email"],
    phone: ["contactphone", "phone"],
    linkedin: ["contactlinkedin", "linkedin"],
    rep: ["assignedsalesrep", "salesrep", "rep"],
    priority: ["priority"],
    notes: ["researchnotes", "notes"],
    city: ["city"],
    state: ["state"],
  },
  activities: {
    ref: ["leadid", "id", "ref"],
    email: ["contactemail", "email"],
    emailReply: ["emailreply"],
    callDate: ["calldate"],
    callOutcome: ["calloutcome"],
    discoveryDate: ["discoveryauditdate", "discoverydate"],
    dealClosed: ["dealclosedyn", "dealclosed"],
    notes: ["notes"],
    rep: ["salesrep", "rep"],
  },
  linkedin: {
    url: ["posturl", "postlink", "url", "link"],
    author: ["author", "postedby"],
    postedAt: ["postpublishdate", "createddate", "date", "publishdate"],
    text: ["posttitle", "postcommentary", "text", "post"],
    impressions: ["impressions"],
    clicks: ["clicks"],
    reactions: ["reactions", "likes"],
    comments: ["comments"],
    reposts: ["reposts", "shares"],
    engagements: ["engagements"],
  },
};

const toDate = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  // Typos like 90/25/2026 are dropped, not rolled into another year.
  if (us && (Number(us[1]) < 1 || Number(us[1]) > 12 || Number(us[2]) < 1 || Number(us[2]) > 31)) return null;
  const d = us ? new Date(Date.UTC(us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]), us[1] - 1, us[2], 12)) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const toNum = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return String(v ?? "").trim() && Number.isFinite(n) ? n : null;
};
const tierOf = (v) => {
  const m = String(v ?? "").match(/[1-4]/);
  return m ? Number(m[0]) : null;
};
const cleanEmail = (v) => {
  const s = String(v || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
};
// "=HYPERLINK("https://x.com","x.com")" → https://x.com
const cleanUrl = (v) => {
  const s = String(v || "").trim();
  const m = s.match(/hyperlink\(\s*"([^"]+)"/i);
  return m ? m[1] : s;
};

function readCsv(text, known = null) {
  const rows = parse(String(text || ""), { relax_column_count: true, skip_empty_lines: true, bom: true, trim: true });
  if (!rows.length) return { header: [], records: [] };
  // Some sheets have a title row (often merged across the top) above the
  // header: use the row among the first 5 with the most recognized columns.
  let h = 0;
  if (known) {
    let best = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i += 1) {
      const hits = new Set(rows[i].map(key).filter((k) => known.has(k))).size;
      if (hits > best) {
        best = hits;
        h = i;
      }
    }
  }
  const header = rows[h].map(key);
  const records = rows.slice(h + 1).map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ""])));
  return { header, records };
}

function pickFields(kind, rec) {
  const out = {};
  for (const [field, aliases] of Object.entries(ALIASES[kind])) {
    const hit = aliases.find((a) => rec[a] !== undefined && String(rec[a]).trim() !== "");
    out[field] = hit ? String(rec[hit]).trim() : "";
  }
  return out;
}

/** CSV text → clean records for one kind (pure). */
function normalize(kind, text, { defaultTier = null } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`Unknown import kind: ${kind}`);
  const known = new Set(Object.values(ALIASES[kind]).flat());
  const { header, records } = readCsv(text, known);
  const matched = header.filter((h) => known.has(h));
  const rows = records.map((r) => pickFields(kind, r));
  let out = [];
  if (kind === "facilities") {
    out = rows
      .filter((r) => r.name)
      .map((r) => ({
        ref: r.ref,
        name: r.name,
        city: r.city,
        state: r.state,
        timeZone: r.timeZone,
        facilityType: r.facilityType,
        group: r.group,
        buildingsInGroup: toNum(r.buildingsInGroup),
        website: cleanUrl(r.website),
        domain: domainOf(r.website),
        frontDeskPhone: r.frontDeskPhone,
        tier: tierOf(r.tier) ?? defaultTier,
        score: toNum(r.score),
        whyTier: r.whyTier,
        stage: r.stage,
        attempts: toNum(r.attempts) || 0,
        lastCallDate: toDate(r.lastCallDate),
        nextStep: r.nextStep,
        nextDate: toDate(r.nextDate),
        scheduler: { name: r.schedulerName, title: r.schedulerTitle, email: cleanEmail(r.schedulerEmail), phone: r.schedulerPhone },
        currentTool: r.currentTool,
        biggestPain: r.biggestPain,
        leadRef: r.leadRef,
        notes: [r.notes, r.oldHistory && `Earlier: ${r.oldHistory}`].filter(Boolean).join("\n"),
      }));
  } else if (kind === "contacts") {
    out = rows
      .filter((r) => r.name || r.email)
      .map((r) => ({
        ref: r.ref,
        name: r.name,
        title: r.title,
        role: roleFromTitle(r.title),
        email: cleanEmail(r.email),
        phone: r.phone,
        linkedin: cleanUrl(r.linkedin),
        group: r.group,
        facilityName: r.facilityName,
        buildingsInGroup: toNum(r.buildingsInGroup),
        city: r.city,
        state: r.state,
        priority: r.priority,
        rep: r.rep,
        notes: r.notes,
      }));
  } else if (kind === "activities") {
    out = rows
      .filter((r) => r.ref || r.email)
      .map((r) => ({
        ref: r.ref,
        email: cleanEmail(r.email),
        emailReply: r.emailReply,
        callDate: toDate(r.callDate),
        callOutcome: r.callOutcome,
        discoveryDate: toDate(r.discoveryDate),
        dealClosed: r.dealClosed,
        notes: r.notes,
        rep: r.rep,
      }))
      .filter((r) => r.callDate || r.callOutcome || r.notes || r.emailReply || r.discoveryDate || r.dealClosed);
  } else {
    out = rows
      .filter((r) => /^https?:\/\//i.test(cleanUrl(r.url)))
      .map((r) => {
        const reactions = toNum(r.reactions);
        return {
          url: cleanUrl(r.url),
          author: r.author,
          postedAt: toDate(r.postedAt),
          text: r.text.slice(0, 500),
          impressions: toNum(r.impressions) || 0,
          clicks: toNum(r.clicks) || 0,
          // Personal exports only have "Engagements"; keep it as reactions.
          reactions: reactions ?? (toNum(r.engagements) || 0),
          comments: toNum(r.comments) || 0,
          reposts: toNum(r.reposts) || 0,
        };
      });
  }
  return { rows: out, matchedColumns: matched, totalRows: records.length };
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Writes normalized rows. Returns { created, updated, skipped }. */
async function apply(kind, rows, { by = "" } = {}) {
  const HqFacility = require("../../models/hqFacilityModel");
  const HqContact = require("../../models/hqContactModel");
  const HqActivity = require("../../models/hqActivityModel");
  const HqLinkedinPost = require("../../models/hqLinkedinPostModel");
  const result = { created: 0, updated: 0, skipped: 0 };

  if (kind === "facilities") {
    for (const r of rows) {
      const filter = r.ref ? { ref: r.ref } : { name: r.name, city: r.city, state: r.state };
      const res = await HqFacility.updateOne(filter, { $set: { ...r, source: "crm" } }, { upsert: true });
      if (res.upsertedCount) result.created += 1;
      else result.updated += 1;
    }
    return result;
  }

  if (kind === "contacts") {
    // Link each contact to its entry-point building; create the building if it's new.
    const facilities = await HqFacility.find({}).select("name group leadRef").lean();
    const byName = new Map(facilities.map((f) => [norm(f.name), f]));
    // The call list remembers which CRM lead each building came from.
    const byLead = new Map(facilities.filter((f) => f.leadRef).map((f) => [f.leadRef, f]));
    for (const r of rows) {
      const { buildingsInGroup, city, state, ...contact } = r;
      let facility = (r.ref && byLead.get(r.ref)) || (r.facilityName ? byName.get(norm(r.facilityName)) : null);
      if (!facility && r.facilityName) {
        facility = await HqFacility.create({
          name: r.facilityName,
          group: r.group,
          buildingsInGroup,
          city: city || "",
          state: state || "",
          domain: domainOf(r.email),
          source: "crm",
        });
        byName.set(norm(r.facilityName), facility);
      }
      const doc = { ...contact, facilityId: facility?._id || null, source: "crm" };
      const filter = r.ref ? { ref: r.ref } : r.email ? { email: r.email } : { name: r.name, group: r.group };
      const res = await HqContact.updateOne(filter, { $set: doc }, { upsert: true });
      if (res.upsertedCount) result.created += 1;
      else result.updated += 1;
    }
    return result;
  }

  if (kind === "activities") {
    for (const r of rows) {
      const contact = await HqContact.findOne(r.ref ? { ref: r.ref } : { email: r.email }).select("_id facilityId").lean();
      if (!contact) {
        result.skipped += 1;
        continue;
      }
      const set = {};
      if (r.emailReply) set.emailReply = r.emailReply;
      if (r.dealClosed) set.dealClosed = r.dealClosed;
      if (Object.keys(set).length) await HqContact.updateOne({ _id: contact._id }, { $set: set });
      const base = { contactId: contact._id, facilityId: contact.facilityId, by: r.rep || by };
      const acts = [];
      if (r.callDate || r.callOutcome)
        acts.push({ ...base, kind: "call", outcome: r.callOutcome, notes: r.notes, at: r.callDate || new Date(), importKey: `outreach:${r.ref || r.email}:call` });
      if (r.discoveryDate)
        acts.push({ ...base, kind: "meeting", outcome: "Discovery / audit", at: r.discoveryDate, importKey: `outreach:${r.ref || r.email}:discovery` });
      if (r.emailReply)
        acts.push({ ...base, kind: "email", outcome: `Reply: ${r.emailReply}`, at: r.callDate || new Date(), importKey: `outreach:${r.ref || r.email}:reply` });
      if (!acts.length && r.notes)
        acts.push({ ...base, kind: "note", notes: r.notes, at: new Date(), importKey: `outreach:${r.ref || r.email}:note` });
      for (const a of acts) {
        const res = await HqActivity.updateOne({ importKey: a.importKey }, { $set: a }, { upsert: true });
        if (res.upsertedCount) result.created += 1;
        else result.updated += 1;
      }
    }
    return result;
  }

  for (const r of rows) {
    const res = await HqLinkedinPost.updateOne({ url: r.url }, { $set: r }, { upsert: true });
    if (res.upsertedCount) result.created += 1;
    else result.updated += 1;
  }
  return result;
}

module.exports = { KINDS, normalize, apply, readCsv, toDate };
