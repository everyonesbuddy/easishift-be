const mongoose = require("mongoose");

/** An email from HQ Money asking a customer to pay a failed invoice (or a test copy to ourselves). */
const schema = new mongoose.Schema(
  {
    subscriptionId: { type: String, required: true, index: true },
    invoiceId: { type: String, default: "" },
    to: { type: String, default: "" },
    subject: { type: String, default: "" },
    test: { type: Boolean, default: false },
    by: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("HqMoneyNudge", schema);
