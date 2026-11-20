const mongoose = require("mongoose");

/**
 * HQ referral partner: anyone owners already trust who introduces clients
 * (a happy customer, a nurse or pharmacy consultant, a coach, a training
 * school, a payroll firm, a software vendor…). They don't get an account; they get a
 * code. Workspaces that sign up with the code are theirs (Tenant.referralCode),
 * and the fee is due once one of them has paid 2 months.
 */
const logSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    kind: { type: String, enum: ["call", "email", "meeting", "text", "note"], default: "note" },
    text: { type: String, trim: true, default: "" },
    by: { type: String, trim: true, default: "" },
  },
  { _id: true },
);

const feeSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },
    paidAt: { type: Date, default: Date.now },
    amount: { type: Number, default: 0 },
    by: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const hqPartnerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // the business, e.g. "Safe Hands Services"
    contactName: { type: String, trim: true, default: "" },
    type: { type: String, enum: ["customer", "nurse", "pharmacy", "coach", "consultant", "trainer", "billing", "insurance", "software", "attorney", "association", "other"], default: "other" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    phone: { type: String, trim: true, default: "" },
    website: { type: String, trim: true, default: "" },
    area: { type: String, trim: true, default: "" }, // e.g. "Maryland & DC"
    code: { type: String, trim: true, uppercase: true, default: null }, // the Stripe promotion code, e.g. "SAFEHANDS"
    fee: { type: Number, default: 250 },
    status: { type: String, enum: ["new", "contacted", "call", "agreed", "active", "quiet"], default: "new" },
    statusAt: { type: Date, default: Date.now },
    nextDate: { type: Date, default: null },
    notes: { type: String, default: "" },
    log: { type: [logSchema], default: [] },
    feesPaid: { type: [feeSchema], default: [] },
  },
  { timestamps: true },
);

hqPartnerSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { code: { $type: "string" } } });

module.exports = mongoose.model("HqPartner", hqPartnerSchema);
