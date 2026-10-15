/**
 * Make a link a customer can use to pay for their WiserShifts plan.
 *
 * Preview first (no Stripe calls):
 *   node scripts/create-payment-link.js <tenantId> <plan>
 * Then create it:
 *   node scripts/create-payment-link.js <tenantId> <plan> --create
 *
 * <plan>: starter | growth | premium
 *
 * Options:
 *   --interval=month|year        Billing period (default month)
 *   --pay-by=link|invoice        link (default): a payment link, card or ACH
 *                                debit, renews on its own.
 *                                invoice: an emailed invoice each period
 *                                (card, ACH debit, or bank transfer), for
 *                                accounts-payable teams.
 *   --email=billing@company.com  Who pays. Filled in on the link; required
 *                                for invoices. Defaults to the workspace's
 *                                billing email.
 *   --amount=450                 Custom price in dollars per period (e.g. a
 *                                founding price). Default: the list price.
 *   --back-pay="September 2026"  Also charge one extra period now, once.
 *   --days-until-due=30          Invoices only (default 30).
 *   --send-invoice               Invoices only: Stripe emails it now.
 *   --notify-email=you@...       Email the link to you as well.
 *   --confirm-live               Required when using a live Stripe key.
 *   --attempt=2                  Make a new link instead of returning the
 *                                same one again (same options, same day).
 */
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", "config.env") });

const mongoose = require("mongoose");
const Stripe = require("stripe");
const Tenant = require("../models/tenantModel");
const { sendEmail } = require("../utils/sendEmail");
const pay = require("../utils/paymentLinks");

async function main() {
  const opts = pay.validate(pay.parseArgs(process.argv.slice(2)));

  if (!process.env.DB_URL) throw new Error("DB_URL is missing from config.env");
  await mongoose.connect(process.env.DB_URL);

  const tenant = await Tenant.findById(opts.tenantId);
  if (!tenant) throw new Error("Tenant not found");
  const blocked = pay.existingSubscriptionError(tenant);
  if (blocked) throw new Error(blocked);

  const email = opts.email || tenant.billingEmail || tenant.email || null;
  console.log(pay.summary(tenant, opts, email));

  if (!opts.create) {
    console.log("\nPreview only. Add --create to make it.");
    return;
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.includes("dummy")) throw new Error("STRIPE_SECRET_KEY is missing from config.env");
  const isLive = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (isLive && !opts.confirmLive) {
    throw new Error("This is a LIVE Stripe key. Check the preview above, then rerun with --confirm-live.");
  }

  const stripe = Stripe(key);
  const result = await pay.createPayment(
    { stripe, saveTenant: (update) => Tenant.findByIdAndUpdate(tenant._id, update) },
    tenant,
    opts,
    email,
  );

  console.log(`\nStripe mode: ${isLive ? "LIVE" : "TEST"}`);
  if (result.kind === "link") {
    console.log(`Payment link (${result.id}), one payment, doesn't expire:`);
  } else {
    console.log(`Invoice ${result.id} for subscription ${result.subscriptionId}${result.emailed ? ", emailed to " + email : ""}:`);
    if (result.pdf) console.log(`PDF: ${result.pdf}`);
  }
  console.log(result.url);

  if (opts.notifyEmail) {
    const text = `${pay.summary(tenant, opts, email)}\n\n${result.url}`;
    const html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
    const sent = await sendEmail(opts.notifyEmail, `Payment link for ${tenant.name}`, html, text);
    console.log(sent.success ? `Also emailed to ${opts.notifyEmail}` : `Email to ${opts.notifyEmail} failed: ${sent.error}`);
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
