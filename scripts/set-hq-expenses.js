/**
 * Set HQ Money's usual monthly costs for our tools in one go.
 *
 *   heroku run node scripts/set-hq-expenses.js            # shows what it would change; saves nothing
 *   heroku run node scripts/set-hq-expenses.js --apply    # saves it
 *   ... --from=2026-03   # when expenses that don't exist yet started (default: January this year)
 *
 * An expense that's already in HQ (matched by name, e.g. "Klaviyo" or
 * "klaviyo email") gets its usual amount updated; its category, dates and
 * other months stay as they are. Ones that aren't there are added. One-off
 * months (Copilot's August) are set on that month only.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", "config.env") });
const mongoose = require("mongoose");
const HqExpense = require("../models/hqExpenseModel");

const YEAR = new Date().getFullYear();
const COSTS = [
  { name: "Google Workspace", match: /google\s*workspace|g\s*suite|gmail/i, amount: 45, category: "Software" },
  { name: "Klaviyo", match: /klaviyo/i, amount: 30, category: "Marketing" },
  { name: "Postmark", match: /postmark/i, amount: 15, category: "Software" },
  { name: "Twilio", match: /twilio/i, amount: 20, category: "Software" },
  { name: "GitHub Copilot", match: /copilot/i, amount: 10, category: "Software", months: { [`${YEAR}-08`]: 130 } },
  { name: "Claude", match: /claude|anthropic/i, amount: 20, category: "Software" },
];

(async () => {
  const apply = process.argv.includes("--apply");
  const fromArg = (process.argv.find((a) => a.startsWith("--from=")) || "").slice(7);
  const from = /^\d{4}-\d{2}$/.test(fromArg) ? fromArg : `${YEAR}-01`;
  await mongoose.connect(process.env.DB_URL);
  const existing = await HqExpense.find({}).lean();
  console.log(apply ? "Saving these changes:\n" : "Would change (nothing saved; add --apply to save):\n");

  for (const c of COSTS) {
    const found = existing.filter((e) => c.match.test(e.name));
    if (found.length > 1) {
      console.log(`  ? ${c.name}: ${found.length} expenses match (${found.map((e) => e.name).join(", ")}). Skipped; change it in HQ.`);
      continue;
    }
    const monthsNote = c.months ? `, ${Object.entries(c.months).map(([m, v]) => `${m} = $${v}`).join(", ")}` : "";
    if (found.length === 1) {
      const e = found[0];
      const sameMonths = !c.months || Object.entries(c.months).every(([m, v]) => e.months?.[m] === v);
      if (e.amount === c.amount && e.cadence === "monthly" && sameMonths) {
        console.log(`  = ${e.name}: already $${c.amount}/month${monthsNote}`);
        continue;
      }
      console.log(`  ~ ${e.name}: $${e.amount}/${e.cadence === "monthly" ? "month" : e.cadence} → $${c.amount}/month${monthsNote}`);
      if (apply) {
        const set = { amount: c.amount, cadence: "monthly" };
        for (const [m, v] of Object.entries(c.months || {})) set[`months.${m}`] = v;
        await HqExpense.updateOne({ _id: e._id }, { $set: set });
      }
    } else {
      console.log(`  + ${c.name}: new, $${c.amount}/month from ${from}${monthsNote} (${c.category})`);
      if (apply) await HqExpense.create({ name: c.name, category: c.category, cadence: "monthly", amount: c.amount, startMonth: from, months: c.months || {} });
    }
  }
  const others = existing.filter((e) => !COSTS.some((c) => c.match.test(e.name)));
  if (others.length) console.log(`\nNot touched: ${others.map((e) => `${e.name} ($${e.amount}/${e.cadence === "monthly" ? "month" : e.cadence})`).join(", ")}`);
  console.log(apply ? "\nDone. Refresh HQ → Profit & loss." : "\nLooks right? Run it again with --apply.");
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
