/**
 * Payment links we create by hand for a customer (scripts/create-payment-link.js).
 *
 * Two ways to pay:
 * - "link" (default): a Stripe Payment Link. The customer pays by card or
 *   bank account (ACH debit) and the subscription renews on its own. The
 *   link doesn't expire and can be paid once.
 * - "invoice": a subscription billed by invoice (net N days). Stripe emails
 *   an invoice each period that can be paid by card, ACH debit, or a bank
 *   transfer (ACH credit) to account numbers printed on the invoice. Good for
 *   accounts-payable teams.
 *
 * The tenant is tied to the subscription through subscription metadata
 * (tenantId), which the webhook reads.
 */
const { PLANS, PAID_PLAN_KEYS, PLAN_PRICES, PAID_STATUSES } = require("../config/plans");

const INTERVALS = ["month", "year"];
const PAY_BY = ["link", "invoice"];

const formatUsd = (cents) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function parseArgs(argv) {
  const opts = { interval: "month", payBy: "link", daysUntilDue: 30, bankTransfer: true };
  const positional = [];
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? true : arg.slice(eq + 1).trim();
    switch (key) {
      case "interval": opts.interval = value; break;
      case "pay-by": opts.payBy = value; break;
      case "email": opts.email = value; break;
      case "amount": opts.amount = value; break;
      case "back-pay": opts.backPay = value; break;
      case "days-until-due": opts.daysUntilDue = Number(value); break;
      case "notify-email": opts.notifyEmail = value; break;
      case "attempt": opts.attempt = value; break;
      case "create": opts.create = true; break;
      case "confirm-live": opts.confirmLive = true; break;
      case "send-invoice": opts.sendInvoice = true; break;
      case "no-bank-transfer": opts.bankTransfer = false; break;
      default: throw new Error(`Unknown option --${key}`);
    }
  }
  [opts.tenantId, opts.plan] = positional;
  return opts;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks the options; returns them with amounts in cents. Throws on bad input. */
function validate(opts) {
  if (!opts.tenantId || !opts.plan) throw new Error("A tenant ID and a plan are required");
  if (!/^[a-f0-9]{24}$/i.test(opts.tenantId)) throw new Error("Tenant ID must be a 24-character Mongo ID");
  if (!PAID_PLAN_KEYS.includes(opts.plan)) throw new Error(`Plan must be one of: ${PAID_PLAN_KEYS.join(", ")}`);
  if (!INTERVALS.includes(opts.interval)) throw new Error("--interval must be month or year");
  if (!PAY_BY.includes(opts.payBy)) throw new Error("--pay-by must be link or invoice");
  if (opts.email && !EMAIL_RE.test(opts.email)) throw new Error("--email is not a valid email address");
  if (opts.notifyEmail && !EMAIL_RE.test(opts.notifyEmail)) throw new Error("--notify-email is not a valid email address");
  if (opts.attempt && !/^[a-zA-Z0-9_-]{1,50}$/.test(opts.attempt)) throw new Error("--attempt must be 1-50 letters, numbers, dashes or underscores");
  if (opts.backPay && (opts.backPay === true || opts.backPay.length > 80)) throw new Error("--back-pay needs a short label, e.g. --back-pay=\"September 2026\"");
  if (opts.payBy === "invoice" && !(Number.isInteger(opts.daysUntilDue) && opts.daysUntilDue >= 1 && opts.daysUntilDue <= 90)) {
    throw new Error("--days-until-due must be a whole number from 1 to 90");
  }
  let amountCents = PLAN_PRICES[opts.plan][opts.interval];
  if (opts.amount !== undefined) {
    const dollars = Number(String(opts.amount).replace(/[$,]/g, ""));
    if (!Number.isFinite(dollars) || dollars < 1) throw new Error("--amount must be a dollar amount, e.g. --amount=450");
    amountCents = Math.round(dollars * 100);
  }
  return { ...opts, amountCents, customAmount: opts.amount !== undefined };
}

/** A tenant that already pays through Stripe must change plans in the app instead. */
function existingSubscriptionError(tenant) {
  if (tenant.stripeSubscriptionId && PAID_STATUSES.includes(tenant.subscriptionStatus)) {
    return `${tenant.name} already has an active Stripe subscription (${tenant.stripeSubscriptionId}). Change plans from Billing in the app or the Stripe dashboard instead.`;
  }
  return null;
}

function summary(tenant, o, email) {
  const per = o.interval === "year" ? "year" : "month";
  const lines = [
    `Tenant:   ${tenant.name} (${tenant._id})`,
    `Plan:     WiserShifts ${PLANS[o.plan].label}, billed every ${per}${o.customAmount ? " (custom price)" : ""}`,
    `Price:    ${formatUsd(o.amountCents)}/${per}`,
  ];
  if (o.backPay) lines.push(`Back pay: ${formatUsd(o.amountCents)} once, for "${o.backPay}"`);
  lines.push(`Due now:  ${formatUsd(o.amountCents * (o.backPay ? 2 : 1))}`);
  lines.push(
    o.payBy === "invoice"
      ? `Pay by:   invoice, due in ${o.daysUntilDue} days (card, ACH debit${o.bankTransfer ? ", or bank transfer" : ""})`
      : "Pay by:   payment link (card or ACH debit from a bank account), renews automatically",
  );
  lines.push(`Email:    ${email || (o.payBy === "invoice" ? "(none: required for invoices)" : "customer types it in")}`);
  return lines.join("\n");
}

const metadataFor = (tenant, o) => ({
  tenantId: String(tenant._id),
  plan: o.plan,
  interval: o.interval,
  source: o.payBy === "invoice" ? "operator_invoice" : "operator_payment_link",
});

const idemKey = (tenant, o, part) =>
  ["ws-pay", part, String(tenant._id), o.plan, o.interval, o.amountCents, o.payBy, o.bankTransfer === false ? "nobt" : "", o.backPay || "", o.attempt || ""].join(":");

/** The recurring Price: a dashboard Price from env when it matches, else one made here. */
async function recurringPriceId(stripe, tenant, o) {
  const envName = `STRIPE_PRICE_${o.plan.toUpperCase()}_${o.interval === "year" ? "YEARLY" : "MONTHLY"}`;
  if (!o.customAmount && process.env[envName]) return process.env[envName];
  const price = await stripe.prices.create(
    {
      currency: "usd",
      unit_amount: o.amountCents,
      recurring: { interval: o.interval },
      product_data: { name: `WiserShifts ${PLANS[o.plan].label}` },
      metadata: { plan: o.plan, interval: o.interval },
    },
    { idempotencyKey: idemKey(tenant, o, "price") },
  );
  return price.id;
}

async function backPayPriceId(stripe, tenant, o) {
  if (!o.backPay) return null;
  const price = await stripe.prices.create(
    {
      currency: "usd",
      unit_amount: o.amountCents,
      product_data: { name: `WiserShifts ${PLANS[o.plan].label}: ${o.backPay}` },
      metadata: { plan: o.plan, backPay: o.backPay },
    },
    { idempotencyKey: idemKey(tenant, o, "backpay") },
  );
  return price.id;
}

const CONFIRMATION =
  "Thank you! Your WiserShifts plan is being activated. Card payments are instant; bank (ACH) payments take a few business days to clear, and you'll get an emailed receipt when they do.";

function paymentLinkParams(tenant, o, priceId, backPayId) {
  const metadata = metadataFor(tenant, o);
  return {
    line_items: [
      { price: priceId, quantity: 1 },
      ...(backPayId ? [{ price: backPayId, quantity: 1 }] : []),
    ],
    payment_method_types: ["card", "us_bank_account"],
    metadata,
    // The webhook reads the tenant from here (sessions from a payment link
    // don't carry our metadata).
    subscription_data: { metadata },
    // One payment per link, so nobody pays twice.
    restrictions: { completed_sessions: { limit: 1 } },
    after_completion: { type: "hosted_confirmation", hosted_confirmation: { custom_message: CONFIRMATION } },
  };
}

function invoiceSubscriptionParams(tenant, o, customerId, priceId, backPayId) {
  return {
    customer: customerId,
    items: [{ price: priceId }],
    ...(backPayId ? { add_invoice_items: [{ price: backPayId }] } : {}),
    collection_method: "send_invoice",
    days_until_due: o.daysUntilDue,
    metadata: metadataFor(tenant, o),
    payment_settings: o.bankTransfer === false
      ? { payment_method_types: ["card", "us_bank_account"] }
      : {
          payment_method_types: ["card", "us_bank_account", "customer_balance"],
          payment_method_options: {
            customer_balance: { funding_type: "bank_transfer", bank_transfer: { type: "us_bank_transfer" } },
          },
        },
  };
}

/** A link for the customer to open, with their email filled in when known. */
function withPrefilledEmail(url, email) {
  if (!email) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}prefilled_email=${encodeURIComponent(email)}`;
}

/**
 * Creates the link or invoice. `deps` = { stripe, saveTenant(update) }.
 * Returns { url, kind, ... } for the caller to print or email.
 */
async function createPayment({ stripe, saveTenant }, tenant, o, email) {
  const priceId = await recurringPriceId(stripe, tenant, o);
  const backPayId = await backPayPriceId(stripe, tenant, o);

  if (o.payBy === "link") {
    const link = await stripe.paymentLinks.create(paymentLinkParams(tenant, o, priceId, backPayId), {
      idempotencyKey: idemKey(tenant, o, "link"),
    });
    return { kind: "link", id: link.id, url: withPrefilledEmail(link.url, email) };
  }

  if (!email) throw new Error("Invoices need an email: pass --email=billing@their-company.com");
  let customerId = tenant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email, name: tenant.name, metadata: { tenantId: String(tenant._id) } },
      { idempotencyKey: idemKey(tenant, o, "customer") },
    );
    customerId = customer.id;
  }
  const subscription = await stripe.subscriptions.create(
    invoiceSubscriptionParams(tenant, o, customerId, priceId, backPayId),
    { idempotencyKey: idemKey(tenant, o, "subscription") },
  );
  const invoiceId = typeof subscription.latest_invoice === "string" ? subscription.latest_invoice : subscription.latest_invoice?.id;
  let invoice = await stripe.invoices.finalizeInvoice(invoiceId);
  if (o.sendInvoice) invoice = await stripe.invoices.sendInvoice(invoice.id);

  await saveTenant({
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    billingEmail: email,
    subscriptionStatus: subscription.status,
    plan: o.plan,
    billingInterval: o.interval,
  });
  return {
    kind: "invoice",
    id: invoice.id,
    url: invoice.hosted_invoice_url,
    pdf: invoice.invoice_pdf,
    subscriptionId: subscription.id,
    emailed: Boolean(o.sendInvoice),
  };
}

module.exports = {
  parseArgs,
  validate,
  existingSubscriptionError,
  summary,
  paymentLinkParams,
  invoiceSubscriptionParams,
  withPrefilledEmail,
  createPayment,
  formatUsd,
};
