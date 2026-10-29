/**
 * Calculator / website leads: saved in HQ and sent to Klaviyo (profile +
 * "Used Calculator" event; newsletter list only if they ticked the box).
 * Replaces the old beehiiv pop-up.
 */
const HqLead = require("../../models/hqLeadModel");
const klaviyo = require("./klaviyo");

const SOURCES = [
  "call-out-cost", "overtime-cost", "payroll-accuracy", "time-clock-accuracy", "turnover-roi", "cost-leak",
  "hours-per-resident-day", "schedule-coverage", "newsletter", "blog",
];
const isEmail = (v) => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";

const cleanUtm = (u) => {
  if (!u || typeof u !== "object") return null;
  const out = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer", "landingPage"]) {
    const v = str(u[k], 300);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
};

/** Validates and stores; Klaviyo runs in the background. Returns the lead or null. */
async function captureLead({ email, source, company, summary, newsletter, utm }) {
  if (!isEmail(email)) return null;
  const lead = await HqLead.create({
    email: email.trim().toLowerCase(),
    source: !SOURCES.includes(source) ? "calculator:other" : ["newsletter", "blog"].includes(source) ? source : `calculator:${source}`,
    company: str(company, 120),
    summary: str(summary, 300),
    newsletter: truthy(newsletter),
    utm: cleanUtm(utm),
  });
  klaviyo
    .sendLead(lead)
    .then((r) => HqLead.updateOne({ _id: lead._id }, { $set: { "klaviyo.synced": r.synced, "klaviyo.error": r.error } }))
    .catch(() => {});
  return lead;
}

/**
 * Express middleware for the existing calculator email routes: records the
 * lead, then lets the route send the summary email as before.
 */
const captureCalculatorLead = (source) => (req, res, next) => {
  const b = req.body || {};
  captureLead({
    email: b.recipientEmail,
    source,
    company: b.inputs?.companyName,
    summary: b.summary,
    newsletter: b.newsletter,
    utm: b.utm,
  }).catch((err) => console.error("HQ lead capture failed:", err?.message));
  next();
};

module.exports = { captureLead, captureCalculatorLead, SOURCES, isEmail };
