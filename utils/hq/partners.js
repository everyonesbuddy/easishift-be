/**
 * HQ referral partners, as pure functions: what each referred workspace
 * has paid and whether the partner's fee is due.
 *
 * Two kinds of deal: flat ($250 once per client, due after 2 paid months;
 * the free month doesn't count) or a percentage of what each client pays
 * for a number of months from their first payment. Payouts are recorded
 * per client; whatever's earned and not yet paid out is owed.
 */
const MONTHS_FOR_FEE = 2;

const TYPES = {
  customer: "Happy customer",
  nurse: "Nurse consultant (delegating nurse, RN)",
  pharmacy: "Pharmacy consultant",
  coach: "Coach (how to open a group home or assisted living)",
  consultant: "Licensing, startup or compliance consultant",
  trainer: "Training school (CNA, CMT, DSP)",
  billing: "Payroll, billing or accounting firm",
  insurance: "Insurance broker",
  software: "Software vendor (eMAR, EHR, billing)",
  attorney: "Healthcare attorney",
  association: "Provider association",
  other: "Other",
};

const STATUSES = {
  new: "To contact",
  contacted: "Contacted",
  call: "Call booked",
  agreed: "Agreed",
  active: "Sending clients",
  quiet: "Quiet",
};

/**
 * What a customer has paid: invoices marked paid with money in them (the
 * free month has none), oldest first. "months" counts the months paid for,
 * so one yearly payment is 12 (a flat fee is due after 2).
 */
function paidMonths(invoices) {
  const paid = (invoices || [])
    .filter((i) => i.status === "paid" && (i.amount_paid || 0) > 0)
    .sort((a, b) => a.created - b.created)
    .map((i) => ({ at: new Date(i.created * 1000), amount: i.amount_paid / 100, months: monthsCovered(i) }));
  return { months: paid.reduce((n, p) => n + p.months, 0), firstPaidAt: paid[0]?.at || null, total: paid.reduce((n, p) => n + p.amount, 0), payments: paid };
}

/** How many months one paid invoice covers: 12 for a yearly plan, 1 for monthly (from its billing period). */
function monthsCovered(invoice) {
  const line = invoice?.lines?.data?.find((l) => l?.period?.start && l?.period?.end);
  if (!line) return 1;
  return Math.max(1, Math.round((line.period.end - line.period.start) / (30.44 * 86400)));
}

const round2 = (n) => Math.round(n * 100) / 100;
const addMonths = (d, n) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
};

/** The deal in words: "$250 flat per client" or "15% for 12 months". */
function dealWords(partner) {
  if (partner?.dealType === "percent") return `${partner.percent ?? 15}% of what each client pays, for ${partner.percentMonths ?? 12} months`;
  return `$${partner?.fee ?? 250} flat per client, after ${MONTHS_FOR_FEE} paid months`;
}

/**
 * What the partner has earned for one client, so far.
 * flat: the fee, once the client has paid 2 months.
 * percent: percent of each payment in the client's first N months (from their first payment).
 */
function earnedFor(partner, paid) {
  if (partner?.dealType === "percent") {
    if (!paid.firstPaidAt) return { earned: 0, windowEndsAt: null, running: false };
    const ends = addMonths(paid.firstPaidAt, partner.percentMonths ?? 12);
    const inWindow = (paid.payments || []).filter((p) => p.at < ends);
    return { earned: round2((inWindow.reduce((n, p) => n + p.amount, 0) * (partner.percent ?? 15)) / 100), windowEndsAt: ends, running: new Date() < ends };
  }
  return { earned: paid.months >= MONTHS_FOR_FEE ? partner?.fee ?? 250 : 0, windowEndsAt: null, running: false };
}

/**
 * One row per workspace that came in with the partner's code.
 * tenants: [{ _id, name, createdAt, plan, subscriptionStatus, referralRedeemedAt }]
 * paid: Map tenantId → paidMonths(...)
 * feeStatus: "due" (we owe them money now), "paid" (all earned is paid),
 * "running" (percent deal, paid up, still earning), "not_yet" (nothing earned yet).
 */
function referralRows(partner, tenants, paid) {
  const payouts = new Map();
  for (const f of partner.feesPaid || []) {
    const k = String(f.tenantId);
    if (!payouts.has(k)) payouts.set(k, []);
    payouts.get(k).push(f);
  }
  return tenants
    .map((t) => {
      const p = paid.get(String(t._id)) || { months: 0, firstPaidAt: null, total: 0, payments: [] };
      const mine = payouts.get(String(t._id)) || [];
      const { earned, windowEndsAt, running } = earnedFor(partner, p);
      const paidOut = round2(mine.reduce((n, f) => n + (f.amount || 0), 0));
      const owed = round2(Math.max(0, earned - paidOut));
      const lastPaid = mine.map((f) => f.paidAt).sort((a, b) => new Date(b) - new Date(a))[0] || null;
      return {
        tenantId: String(t._id),
        name: t.name,
        signedUpAt: t.createdAt,
        plan: t.plan,
        subscriptionStatus: t.subscriptionStatus || null,
        usedCode: Boolean(t.referralRedeemedAt),
        paidMonths: p.months,
        paidTotal: round2(p.total),
        earned,
        paidOut,
        owed,
        windowEndsAt,
        feeStatus: owed > 0 ? "due" : paidOut > 0 ? (running ? "running" : "paid") : running ? "running" : "not_yet",
        feePaidAt: lastPaid,
        feeAmount: owed,
      };
    })
    .sort((a, b) => new Date(b.signedUpAt) - new Date(a.signedUpAt));
}

/** Totals for the list: introduced, paying, fees due (count and dollars), fees paid. */
function totals(rows) {
  const due = rows.filter((r) => r.owed > 0);
  return {
    introduced: rows.length,
    paying: rows.filter((r) => r.paidMonths > 0).length,
    feesDue: due.length,
    feesDueAmount: round2(due.reduce((n, r) => n + r.owed, 0)),
    feesPaidAmount: round2(rows.reduce((n, r) => n + r.paidOut, 0)),
  };
}

module.exports = { MONTHS_FOR_FEE, TYPES, STATUSES, paidMonths, dealWords, earnedFor, referralRows, totals };
