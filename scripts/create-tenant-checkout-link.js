const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const mongoose = require("mongoose");
const Stripe = require("stripe");
const Tenant = require("../models/tenantModel");
const User = require("../models/userModel");
const { sendEmail } = require("../utils/sendEmail");
const {
  PLANS,
  buildCheckoutLineItems,
} = require("../controllers/stripeController");

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const notifyEmailArg = args.find((arg) => arg.startsWith("--notify-email="));
const notifyEmail = notifyEmailArg
  ? notifyEmailArg.slice("--notify-email=".length).trim()
  : null;
const [tenantId, planKey, priorPeriodLabel] = args.filter(
  (arg) => !arg.startsWith("--"),
);

const usage =
  "node scripts/create-tenant-checkout-link.js <tenantId> <planKey> " +
  '"<prior period label>" [--create] [--confirm-live] ' +
  "[--notify-email=<email>]";

const formatUsd = (cents) => `$${(cents / 100).toFixed(2)}`;

async function main() {
  if (!tenantId || !planKey || !priorPeriodLabel) {
    throw new Error(`Usage: ${usage}`);
  }

  const plan = PLANS[planKey];
  if (!plan || !planKey.endsWith("Monthly")) {
    throw new Error(`"${planKey}" is not a valid monthly plan`);
  }

  if (priorPeriodLabel.length > 100) {
    throw new Error("Prior-period label must be 100 characters or fewer");
  }

  if (notifyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
    throw new Error("--notify-email must contain a valid email address");
  }

  if (!process.env.DB_URL) throw new Error("DB_URL is missing");
  if (!process.env.FRONTEND_URL) throw new Error("FRONTEND_URL is missing");

  await mongoose.connect(process.env.DB_URL);

  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new Error("Tenant not found");
  if (tenant.stripeSubscriptionId) {
    throw new Error(
      `Tenant already has Stripe subscription ${tenant.stripeSubscriptionId}`,
    );
  }

  const seatsInUse = await User.countDocuments({ tenantId: tenant._id });
  if (seatsInUse > plan.seats) {
    throw new Error(
      `${seatsInUse} users exceeds the ${plan.seats}-seat plan limit`,
    );
  }

  const email = tenant.billingEmail || tenant.email;
  const normalizedTenantId = String(tenant._id);
  const dueNowCents = plan.priceCents * 2;

  console.log(`Tenant: ${tenant.name} (${normalizedTenantId})`);
  console.log(`Plan: ${plan.name}, ${plan.seats} seats (${seatsInUse} in use)`);
  console.log(`Email: ${email || "Customer will enter an email"}`);
  console.log(`Prior period: ${priorPeriodLabel}`);
  console.log(`Due now: ${formatUsd(dueNowCents)}`);
  console.log(`Then: ${formatUsd(plan.priceCents)}/month`);

  if (!flags.has("--create")) {
    console.log(`\nPreview only. To create the Session, run:\n${usage}`);
    return;
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey || stripeSecretKey.includes("dummy")) {
    throw new Error("STRIPE_SECRET_KEY is missing");
  }

  const isLive = stripeSecretKey.startsWith("sk_live_");
  if (isLive && !flags.has("--confirm-live")) {
    throw new Error(
      "Live Stripe mode detected; rerun with --confirm-live after reviewing the preview",
    );
  }

  const stripe = Stripe(stripeSecretKey);
  const frontendUrl = process.env.FRONTEND_URL.replace(/\/+$/, "");
  const session = await stripe.checkout.sessions.create(
    {
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: buildCheckoutLineItems(planKey, true, priorPeriodLabel),
      client_reference_id: normalizedTenantId,
      metadata: {
        tenantId: normalizedTenantId,
        planKey,
        source: "operator_checkout_link",
      },
      ...(tenant.stripeCustomerId
        ? { customer: tenant.stripeCustomerId }
        : email
          ? { customer_email: email }
          : {}),
      subscription_data: {
        metadata: { tenantId: normalizedTenantId, planKey },
      },
      success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/billing/cancel`,
    },
    {
      idempotencyKey: `operator-checkout:${normalizedTenantId}:${planKey}:${priorPeriodLabel}`,
    },
  );

  console.log(`\nStripe mode: ${isLive ? "LIVE" : "TEST"}`);
  console.log(`Session ID: ${session.id}`);
  console.log(`Expires: ${new Date(session.expires_at * 1000).toISOString()}`);
  console.log(`Payment link: ${session.url}`);

  if (notifyEmail) {
    const subject = `Checkout link for ${tenant.name}`;
    const text = [
      `Tenant: ${tenant.name} (${normalizedTenantId})`,
      `Plan: ${plan.name}`,
      `Prior period: ${priorPeriodLabel}`,
      `Due now: ${formatUsd(dueNowCents)}`,
      `Then: ${formatUsd(plan.priceCents)}/month`,
      `Expires: ${new Date(session.expires_at * 1000).toISOString()}`,
      "",
      session.url,
    ].join("\n");
    const html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    const result = await sendEmail(notifyEmail, subject, html, text);

    if (!result.success) {
      console.warn(`Email to ${notifyEmail} failed: ${result.error}`);
    } else {
      console.log(`Checkout link emailed to: ${notifyEmail}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
