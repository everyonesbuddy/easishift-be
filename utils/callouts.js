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

/**
 * Creates an offer and sends it. `people` = staff docs (lean).
 */
async function sendCalloutOffer({ tenant, coverage, people, createdBy, timezone }) {
  const offer = await CalloutOffer.create({
    tenantId: tenant._id,
    coverageId: coverage._id,
    createdBy,
    expiresAt: coverage.startTime,
    recipients: people.map((person) => ({
      staffId: person._id,
      name: person.name,
      phoneE164: person.phoneE164 || null,
    })),
  });

  const planKey = getEffectivePlanKey(tenant);
  const when = shortShift(coverage.startTime, coverage.endTime, timezone);
  const role = roleLabel(coverage.role);

  for (const recipient of offer.recipients) {
    const person = people.find((p) => String(p._id) === String(recipient.staffId));
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
  await offer.save();
  return offer;
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
    "recipients.phoneE164": phoneE164,
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
  markOfferFilledIfAny,
  findOpenOfferForPhone,
  findRecentOfferForPhone,
  remainingFor,
};
