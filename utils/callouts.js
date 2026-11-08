/**
 * Call-outs by text
 * -----------------
 * sendCalloutOffer: text/email eligible staff "need a CNA tonight — reply YES".
 * markOfferFilledIfAny: once the slot is full, close the offer, tell the
 * other people it's filled, and tell the schedulers who took it.
 */
const CalloutOffer = require("../models/calloutOfferModel");
const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");
const OutboundMessage = require("../models/outboundMessageModel");
const { getEffectivePlanKey } = require("../config/plans");
const { sendSMS } = require("./sendSMS");
const {
  sendToStaff,
  notifySchedulers,
  shortShift,
  escapeHtml,
  firstName,
} = require("./notify");
const { getStaffLinkUrl } = require("./staffLinks");
const { COVERAGE_OCCUPYING_STATUSES } = require("./scheduleUtils");
const { getWeekSettings } = require("./weekService");

const roleLabel = (role) => String(role || "").replace(/_/g, " ").toUpperCase();

async function remainingFor(coverage) {
  const filled = await Schedule.countDocuments({
    tenantId: coverage.tenantId,
    coverageId: coverage._id,
    status: { $in: COVERAGE_OCCUPYING_STATUSES },
  });
  return Math.max(0, coverage.requiredCount - filled);
}

const WAVE_SIZE = 5;
const WAVE_MINUTES = 10;
const ALL_AT_ONCE_HOURS = 3; // a shift this soon goes to everyone at once

/**
 * Who's most likely to say yes, first: people who've said yes to past
 * offers here (last 90 days), then fewest hours this week (fair, and far from
 * overtime). rows: { staff, weekMinutes }.
 */
async function rankForOffer(tenantId, rows) {
  const since = new Date(Date.now() - 90 * 864e5);
  const history = await CalloutOffer.aggregate([
    { $match: { tenantId, createdAt: { $gte: since } } },
    { $unwind: "$recipients" },
    { $match: { "recipients.sentAt": { $ne: null } } },
    { $group: { _id: "$recipients.staffId", sent: { $sum: 1 }, yes: { $sum: { $cond: [{ $eq: ["$recipients.response", "yes"] }, 1, 0] } } } },
  ]).catch(() => []);
  const rate = new Map(history.map((h) => [String(h._id), (h.yes + 1) / (h.sent + 2)])); // smoothed: new people start in the middle
  return [...rows].sort((a, b) => (rate.get(String(b.staff._id)) ?? 0.5) - (rate.get(String(a.staff._id)) ?? 0.5) || (a.weekMinutes || 0) - (b.weekMinutes || 0));
}

/** Send the offer to these recipients (subdocs) now. */
async function sendTo({ tenant, coverage, offer, people, recipients, timezone }) {
  const planKey = getEffectivePlanKey(tenant);
  const when = shortShift(coverage.startTime, coverage.endTime, timezone);
  const role = roleLabel(coverage.role);
  for (const recipient of recipients) {
    const person = people.find((p) => String(p._id) === String(recipient.staffId));
    if (!person) continue;
    const link = await getStaffLinkUrl(person);
    const result = await sendToStaff({
      tenant,
      planKey,
      staff: person,
      kind: "callout_offer",
      sms: `${tenant.name} needs a ${role} ${when}. Reply YES to take it, or tap: ${link}`,
      emailSubject: `${tenant.name} needs a ${role} ${when}`,
      emailHtml: `
        <p>Hi ${escapeHtml(firstName(person.name))},</p>
        <p>${escapeHtml(tenant.name)} needs a ${escapeHtml(role)} for <strong>${escapeHtml(when)}</strong>. First to accept gets it.</p>
        <p><a href="${link}">Take this shift</a></p>`,
      refId: offer._id,
    });
    recipient.channel = result.delivered ? result.channel : null;
    recipient.sentAt = result.delivered ? new Date() : null;
    recipient.notReachedReason = result.delivered ? null : result.reason;
  }
}

/**
 * Creates an offer and sends it. `people` = staff docs (lean), best first.
 * waves: true sends to the first few now and the rest in waves while it's
 * still open (unless the shift starts within a few hours).
 */
async function sendCalloutOffer({ tenant, coverage, people, createdBy, timezone, waves = false }) {
  const soon = new Date(coverage.startTime) - Date.now() < ALL_AT_ONCE_HOURS * 3600e3;
  const waveSize = waves && !soon && people.length > WAVE_SIZE ? WAVE_SIZE : null;
  const offer = await CalloutOffer.create({
    tenantId: tenant._id,
    coverageId: coverage._id,
    createdBy,
    expiresAt: coverage.startTime,
    waveSize,
    nextWaveAt: waveSize ? new Date(Date.now() + WAVE_MINUTES * 60e3) : null,
    recipients: people.map((person, i) => ({
      staffId: person._id,
      name: person.name,
      phoneE164: person.phoneE164 || null,
      wave: waveSize ? Math.floor(i / waveSize) + 1 : 1,
    })),
  });
  await sendTo({ tenant, coverage, offer, people, recipients: offer.recipients.filter((r) => r.wave === 1), timezone });
  await offer.save();
  return offer;
}

/**
 * Every few minutes: for open offers whose next wave is due, send it to the
 * people in it who can still take the shift. Near the shift's start, everyone
 * left goes at once.
 */
async function sendNextWaves(now = new Date()) {
  let sent = 0;
  const due = await CalloutOffer.find({ status: "open", nextWaveAt: { $ne: null, $lte: now }, expiresAt: { $gt: now } });
  for (const offer of due) {
    try {
      // Claim it so two servers don't both send the wave.
      const claimed = await CalloutOffer.updateOne({ _id: offer._id, nextWaveAt: offer.nextWaveAt }, { $set: { nextWaveAt: null } });
      if (!claimed.modifiedCount) continue;
      const coverage = await Coverage.findById(offer.coverageId).lean();
      if (!coverage || (await remainingFor(coverage)) <= 0) continue;
      const tenant = await Tenant.findById(offer.tenantId).lean();
      const { timezone } = await getWeekSettings(offer.tenantId);
      const waiting = offer.recipients.filter((r) => !r.sentAt && !r.notReachedReason);
      if (!waiting.length) continue;
      const soon = new Date(coverage.startTime) - now < ALL_AT_ONCE_HOURS * 3600e3;
      const nextWave = Math.min(...waiting.map((r) => r.wave || 1));
      let batch = soon ? waiting : waiting.filter((r) => (r.wave || 1) === nextWave);
      // Only people who can still take it (someone may have picked up other shifts since).
      const stillOk = await require("../controllers/calloutController").eligibleNow(offer.tenantId, coverage);
      if (stillOk) {
        for (const r of batch) if (!stillOk.has(String(r.staffId))) r.notReachedReason = "no_longer_eligible";
        batch = batch.filter((r) => stillOk.has(String(r.staffId)));
      }
      const people = await User.find({ _id: { $in: batch.map((r) => r.staffId) } }).lean();
      await sendTo({ tenant, coverage, offer, people, recipients: batch, timezone });
      sent += batch.filter((r) => r.sentAt).length;
      const left = offer.recipients.some((r) => !r.sentAt && !r.notReachedReason);
      offer.nextWaveAt = left ? new Date(now.getTime() + WAVE_MINUTES * 60e3) : null;
      await offer.save();
    } catch (err) {
      console.error(`call-out wave failed for ${offer._id}:`, err.message);
    }
  }
  return { sent };
}

/**
 * Call after someone takes a slot on `coverageId`. Closes any open offer
 * once the slot is full.
 */
async function markOfferFilledIfAny({ tenantId, coverageId, staffId }) {
  try {
    const offer = await CalloutOffer.findOne({
      tenantId,
      coverageId,
      status: "open",
    }).sort({ createdAt: -1 });
    if (!offer) return null;

    const recipient = offer.recipients.find(
      (r) => String(r.staffId) === String(staffId),
    );
    if (recipient) {
      recipient.response = "yes";
      recipient.respondedAt = new Date();
    }

    const coverage = await Coverage.findById(coverageId).lean();
    if (!coverage) return null;
    if ((await remainingFor(coverage)) > 0) {
      await offer.save();
      return offer;
    }

    offer.status = "filled";
    offer.filledBy = staffId;
    offer.filledAt = new Date();
    await offer.save();

    const [tenant, taker] = await Promise.all([
      Tenant.findById(tenantId).lean(),
      User.findById(staffId).select("name").lean(),
    ]);
    const { timezone } = await getWeekSettings(tenantId);
    const when = shortShift(coverage.startTime, coverage.endTime, timezone);

    // Everyone else we texted: it's taken.
    for (const other of offer.recipients) {
      if (String(other.staffId) === String(staffId)) continue;
      if (other.channel !== "sms" || !other.phoneE164) continue;
      const body = `${tenant?.name || "WiserShifts"}: the ${when} shift has been filled. Thanks!`;
      const result = await sendSMS(other.phoneE164, body);
      await OutboundMessage.create({
        tenantId,
        staffId: other.staffId,
        kind: "callout_filled",
        channel: "sms",
        to: other.phoneE164,
        status: result?.success ? "sent" : "failed",
        segments: result?.segments ?? null,
        error: result?.success ? null : String(result?.error || ""),
        refId: offer._id,
      }).catch(() => {});
    }

    await notifySchedulers({
      tenantId,
      subject: `${taker?.name || "Someone"} took the ${when} shift`,
      html: (person) =>
        `<p>Hi ${escapeHtml(firstName(person.name))},</p><p><strong>${escapeHtml(taker?.name || "Someone")}</strong> picked up the ${escapeHtml(roleLabel(coverage.role))} shift on ${escapeHtml(when)}. It's on the schedule.</p>`,
    });
    return offer;
  } catch (err) {
    console.error("markOfferFilledIfAny failed:", err.message);
    return null;
  }
}

/** The open offer (if any) that texted this phone in the last 12 hours. */
const findOpenOfferForPhone = (phoneE164) =>
  CalloutOffer.findOne({
    status: "open",
    // Only offers we actually sent them (people in a later wave haven't seen it yet).
    recipients: { $elemMatch: { phoneE164, sentAt: { $ne: null } } },
    expiresAt: { $gt: new Date() },
    createdAt: { $gt: new Date(Date.now() - 12 * 60 * 60 * 1000) },
  }).sort({ createdAt: -1 });

/** The most recent offer (any status) that texted this phone in 12 hours. */
const findRecentOfferForPhone = (phoneE164) =>
  CalloutOffer.findOne({
    "recipients.phoneE164": phoneE164,
    createdAt: { $gt: new Date(Date.now() - 12 * 60 * 60 * 1000) },
  }).sort({ createdAt: -1 });

module.exports = {
  sendCalloutOffer,
  sendNextWaves,
  rankForOffer,
  WAVE_SIZE,
  WAVE_MINUTES,
  markOfferFilledIfAny,
  findOpenOfferForPhone,
  findRecentOfferForPhone,
  remainingFor,
};
