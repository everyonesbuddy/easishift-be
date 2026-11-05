const mongoose = require("mongoose");

/** A Stripe customer HQ Money leaves out (our own test checkouts): their subscriptions and payments don't count. */
const schema = new mongoose.Schema(
  {
    customerId: { type: String, required: true, unique: true },
    label: { type: String, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("HqMoneyHidden", schema);
