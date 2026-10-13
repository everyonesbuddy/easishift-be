/**
 * Inbound SMS (Twilio webhook): POST /api/v1/sms/inbound
 *
 *   STOP / STOPALL / UNSUBSCRIBE / CANCEL / END / QUIT -> opted out
 *   START / UNSTOP                                      -> opted in + link
 *   YES / Y   -> take the open call-out shift we texted them about
 *               (otherwise treated like START)
 *   HELP      -> help text
 */
const twilio = require("twilio");
const User = require("../models/userModel");
const Tenant = require("../models/tenantModel");
const CalloutOffer = require("../models/calloutOfferModel");
const { getStaffLinkUrl } = require("../utils/staffLinks");
const {
  findOpenOfferForPhone,
  findRecentOfferForPhone,
} = require("../utils/callouts");
const { shortShift } = require("../utils/notify");
const { getWeekSettings } = require("../utils/weekService");
const { claimCoverage } = require("./scheduleController");

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP"]);
const YES_WORDS = new Set(["YES", "Y", "YEP", "YEAH"]);

const escapeXml = (value) =>
  String(value).replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c],
  );

const twiml = (res, message) => {
  res.type("text/xml");
  res.send(
    message
      ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
      : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
  );
};

/** Verifies X-Twilio-Signature. Skipped only outside production when no token is set. */
const isValidTwilioRequest = (req) => {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production";
  const base = String(process.env.API_PUBLIC_URL || "").replace(/\/+$/, "");
  const url = `${base}${req.originalUrl}`;
  return twilio.validateRequest(
    token,
    req.get("X-Twilio-Signature") || "",
    url,
    req.body || {},
  );
};

const markTooLate = async (offerId, matches) => {
  const offer = await CalloutOffer.findById(offerId);
  if (!offer) return;
  for (const recipient of offer.recipients) {
    if (matches(recipient) && recipient.response === "none") {
      recipient.response = "too_late";
      recipient.respondedAt = new Date();
    }
  }
  await offer.save();
};

const setConsent = (ids, status) =>
  User.updateMany(
    { _id: { $in: ids } },
    { $set: { smsConsent: { status, updatedAt: new Date() } } },
  );

const optInReply = async (contacts) => {
  const ids = contacts
    .filter((c) => c.smsConsent?.status !== "opted_in")
    .map((c) => c._id);
  if (ids.length) await setConsent(ids, "opted_in");

  const tenants = await Tenant.find({
    _id: { $in: contacts.map((c) => c.tenantId) },
  })
    .select("name")
    .lean();
  const nameOf = (id) =>
    tenants.find((t) => String(t._id) === String(id))?.name || "your facility";

  const lines = [];
  for (const contact of contacts) {
    lines.push(`${nameOf(contact.tenantId)}: ${await getStaffLinkUrl(contact)}`);
  }
  return contacts.length === 1
    ? `You're subscribed to schedule texts from ${nameOf(contacts[0].tenantId)}. Your schedule: ${lines[0].split(": ").slice(1).join(": ")}`
    : `You're subscribed to schedule texts. Your schedules:\n${lines.join("\n")}`;
};

exports.handleInbound = async (req, res, next) => {
  try {
    if (!isValidTwilioRequest(req)) {
      return res.status(403).send("Invalid signature");
    }

    const from = String(req.body?.From || "").trim();
    const word = String(req.body?.Body || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    if (!from) return twiml(res);

    const contacts = await User.find({
      phoneE164: from,
      loginEnabled: false,
      status: "active",
    });

    if (STOP_WORDS.has(word)) {
      if (contacts.length) await setConsent(contacts.map((c) => c._id), "opted_out");
      return twiml(res); // Twilio sends the carrier-required STOP reply itself
    }

    if (word === "HELP") {
      return twiml(
        res,
        "WiserShifts schedule texts from your workplace. Reply STOP to opt out, START to opt back in. Questions about your schedule? Contact your scheduler.",
      );
    }

    if (!contacts.length) return twiml(res);

    if (YES_WORDS.has(word)) {
      const offer = await findOpenOfferForPhone(from);
      const recipient = offer?.recipients.find((r) => r.phoneE164 === from);
      const staff =
        recipient && contacts.find((c) => String(c._id) === String(recipient.staffId));
      if (offer && staff) {
        // Saying YES to a shift also counts as agreeing to texts.
        if (staff.smsConsent?.status !== "opted_in") await setConsent([staff._id], "opted_in");

        const result = await claimCoverage({
          tenantId: offer.tenantId,
          coverageId: offer.coverageId,
          staff,
          source: "callout",
        });
        const { timezone } = await getWeekSettings(offer.tenantId);
        if (result.ok) {
          const when = shortShift(result.schedule.startTime, result.schedule.endTime, timezone);
          return twiml(res, `You're confirmed for ${when}. Thank you! ${await getStaffLinkUrl(staff)}`);
        }
        await markTooLate(offer._id, (r) => String(r.staffId) === String(staff._id));
        return twiml(
          res,
          result.code === "SHIFT_ALREADY_FILLED"
            ? "Sorry, that shift was already filled. Thanks for offering!"
            : `Sorry, we couldn't give you that shift: ${result.message}.`,
        );
      }
      // We texted them about a shift that's now gone.
      const recent = await findRecentOfferForPhone(from);
      if (recent && recent.status !== "open") {
        await markTooLate(recent._id, (r) => r.phoneE164 === from);
        return twiml(res, "Sorry, that shift was already filled. Thanks for offering!");
      }
      // No offer: a plain YES means "yes, text me".
      return twiml(res, await optInReply(contacts));
    }

    if (START_WORDS.has(word)) {
      return twiml(res, await optInReply(contacts));
    }

    return twiml(res);
  } catch (err) {
    next(err);
  }
};
