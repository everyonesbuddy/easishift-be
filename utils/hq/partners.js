/**
 * HQ referral partners, as pure functions: what each referred workspace
 * has paid and whether the partner's fee is due.
 *
 * The fee is due once a workspace that signed up with the partner's code
 * has paid 2 months (2 invoices with money in them; the free month doesn't
 * count), and it hasn't been marked paid yet.
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

/** How many months a customer has paid: invoices marked paid with money in them. */
function paidMonths(invoices) {
  const paid = (invoices || []).filter((i) => i.status === "paid" && (i.amount_paid || 0) > 0).sort((a, b) => a.created - b.created);
  return { months: paid.length, firstPaidAt: paid[0] ? new Date(paid[0].created * 1000) : null, total: paid.reduce((n, i) => n + i.amount_paid, 0) / 100 };
}

/**
 * One row per workspace that came in with the partner's code.
 * tenants: [{ _id, name, createdAt, plan, subscriptionStatus, referralRedeemedAt }]
 * paid: Map tenantId → { months, firstPaidAt, total }
 */
function referralRows(partner, tenants, paid) {
  const feesPaid = new Map((partner.feesPaid || []).map((f) => [String(f.tenantId), f]));
  return tenants
    .map((t) => {
      const p = paid.get(String(t._id)) || { months: 0, firstPaidAt: null, total: 0 };
      const fee = feesPaid.get(String(t._id)) || null;
      const earned = p.months >= MONTHS_FOR_FEE;
      return {
        tenantId: String(t._id),
        name: t.name,
        signedUpAt: t.createdAt,
        plan: t.plan,
        subscriptionStatus: t.subscriptionStatus || null,
        usedCode: Boolean(t.referralRedeemedAt),
        paidMonths: p.months,
        paidTotal: p.total,
        feeStatus: fee ? "paid" : earned ? "due" : "not_yet",
        feePaidAt: fee?.paidAt || null,
        feeAmount: fee?.amount ?? partner.fee ?? 250,
      };
    })
    .sort((a, b) => new Date(b.signedUpAt) - new Date(a.signedUpAt));
}

/** Totals for the list: introduced, paying, fees due (count and dollars), fees paid. */
function totals(rows, fee = 250) {
  const due = rows.filter((r) => r.feeStatus === "due");
  return {
    introduced: rows.length,
    paying: rows.filter((r) => r.paidMonths > 0).length,
    feesDue: due.length,
    feesDueAmount: due.length * fee,
    feesPaidAmount: rows.filter((r) => r.feeStatus === "paid").reduce((n, r) => n + (r.feeAmount || 0), 0),
  };
}

module.exports = { MONTHS_FOR_FEE, TYPES, STATUSES, paidMonths, referralRows, totals };
