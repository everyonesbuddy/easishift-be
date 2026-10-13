/**
 * Trial emails: one reminder 3 days before the Starter trial ends, one on the
 * day it ends. Each is sent once (tracked on the tenant).
 */
const Tenant = require("../models/tenantModel");
const User = require("../models/userModel");
const { sendEmail } = require("./sendEmail");
const {
  DAY_MS,
  PLANS,
  GRACE_DAYS,
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
    "Texting, swaps, open-shift pickup, call-out texts, automated scheduling, messaging and the time clock turn off; schedules go out by email only. Nothing is deleted, and published weeks and staff links keep working.";
  if (!over.length) return textingLine;
  return `${textingLine} You have ${over.join(" and ")}. You can publish one more week in the next ${GRACE_DAYS} days; after that, publishing pauses until you upgrade or choose who to keep on Free. Extra schedulers can still look but not make changes.`;
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
  const billingUrl = `${appUrl()}/billing`;

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
      `Your WiserShifts Starter trial ends ${endDate}`,
      (owner) => `
        <p>Hi ${owner.name || "there"},</p>
        <p>Your Starter trial for <strong>${tenant.name}</strong> ends on ${endDate}. After that you'll be on Free.</p>
        <p>${impact}</p>
        <p><a href="${billingUrl}">Keep Starter</a></p>`,
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
      "Your WiserShifts Starter trial has ended",
      (owner) => `
        <p>Hi ${owner.name || "there"},</p>
        <p><strong>${tenant.name}</strong> is now on Free. Your schedules, staff and staffing template are all still here.</p>
        <p>${impact}</p>
        <p><a href="${billingUrl}">Choose a plan</a> or pick who to keep on Free.</p>`,
    );
    tenant.trialEndedEmailSentAt = now;
    await tenant.save();
  }
}

module.exports = { sendTrialEmails, describeFreeImpact };
