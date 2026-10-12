/**
 * Trial emails: one reminder 3 days before the Pro trial ends, one on the
 * day it ends. Each is sent once (tracked on the tenant).
 */
const Tenant = require("../models/tenantModel");
const User = require("../models/userModel");
const { sendEmail } = require("./sendEmail");
const {
  DAY_MS,
  PLANS,
  isPaid,
  getEffectivePlanKey,
} = require("../config/plans");
const { countActiveStaff, countSchedulers } = require("./planLimits");

const appUrl = () =>
  String(process.env.FRONTEND_URL || "").replace(/\/+$/, "");

const getOwners = (tenantId) =>
  User.find({ tenantId, $or: [{ roles: "owner" }, { role: "owner" }] })
    .select("name email")
    .lean();

// What Free will mean for this workspace, in one sentence.
const describeFreeImpact = async (tenantId) => {
  const free = PLANS.free;
  const [staff, schedulers] = await Promise.all([
    countActiveStaff(tenantId),
    countSchedulers(tenantId),
  ]);
  const over = [];
  if (staff > free.staff)
    over.push(`${staff} staff (Free allows ${free.staff})`);
  if (schedulers > free.schedulers)
    over.push(`${schedulers} schedulers (Free allows ${free.schedulers})`);
  const textingLine =
    "Texting, shift swaps, open-shift pickup and call-out texts turn off; schedules go out by email only.";
  if (!over.length) return textingLine;
  return `${textingLine} You have ${over.join(" and ")}, so publishing new weeks will pause until you upgrade or archive staff to get under the limit. Nothing is deleted.`;
};

const emailOwners = async (tenant, subject, html) => {
  const owners = await getOwners(tenant._id);
  for (const owner of owners) {
    if (!owner.email) continue;
    await sendEmail(owner.email, subject, html(owner), null, {
      tenantId: tenant._id,
    });
  }
};

async function sendTrialEmails(now = new Date()) {
  const billingUrl = `${appUrl()}/settings/billing`;

  // 1) Reminder: trial ends within the next 3 days.
  const endingSoon = await Tenant.find({
    trialEndsAt: { $gt: now, $lte: new Date(now.getTime() + 3 * DAY_MS) },
    trialReminderSentAt: null,
  });
  for (const tenant of endingSoon) {
    if (isPaid(tenant)) continue;
    const impact = await describeFreeImpact(tenant._id);
    const endDate = new Date(tenant.trialEndsAt).toDateString();
    await emailOwners(
      tenant,
      `Your WiserShifts Pro trial ends ${endDate}`,
      (owner) => `
        <p>Hi ${owner.name || "there"},</p>
        <p>Your Pro trial for <strong>${tenant.name}</strong> ends on ${endDate}. After that you'll be on Free.</p>
        <p>${impact}</p>
        <p><a href="${billingUrl}">Keep Pro</a></p>`,
    );
    tenant.trialReminderSentAt = now;
    await tenant.save();
  }

  // 2) Ended: trial is over and they didn't pay.
  const ended = await Tenant.find({
    trialEndsAt: { $lte: now },
    trialEndedEmailSentAt: null,
  });
  for (const tenant of ended) {
    if (isPaid(tenant) || getEffectivePlanKey(tenant, now) !== "free") {
      tenant.trialEndedEmailSentAt = now;
      await tenant.save();
      continue;
    }
    const impact = await describeFreeImpact(tenant._id);
    await emailOwners(
      tenant,
      "Your WiserShifts Pro trial has ended",
      (owner) => `
        <p>Hi ${owner.name || "there"},</p>
        <p><strong>${tenant.name}</strong> is now on Free. Your schedules, staff and staffing template are all still here.</p>
        <p>${impact}</p>
        <p><a href="${billingUrl}">Choose a plan</a></p>`,
    );
    tenant.trialEndedEmailSentAt = now;
    await tenant.save();
  }
}

module.exports = { sendTrialEmails, describeFreeImpact };
