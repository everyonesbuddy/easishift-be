/**
 * Playbook version 22: the one-page deal says monthly or yearly, and a
 * percentage version sits next to it for partners who negotiate one.
 */
const FLAT = {
  label: "The deal · One page (flat $250)",
  body: `WiserShifts referral partnership

- Your clients: an extra free month when they sign up with code [CODE] (or your link: [signup link]).
- You: $250 once for each client who signs up with your code, whether they pay monthly or yearly. It's due after a monthly client's second paid month, or as soon as a yearly client pays for the year. Paid by [check / Zelle] the following week.
- You tell your clients you receive a referral fee.
- The fee is for introducing WiserShifts only. It isn't tied to residents, care or any other service.
- Either of us can end this any time; fees already earned are still paid.

Signed: ____________ (WiserShifts)   ____________ ([partner])   Date: ________`,
};

const PERCENT = {
  label: "The deal · One page (percentage)",
  body: `WiserShifts referral partnership

- Your clients: an extra free month when they sign up with code [CODE] (or your link: [signup link]).
- You: [15]% of every payment each client you introduce makes in their first [12] months, counted from their first paid month (the free month isn't a payment).
  - Monthly clients: you earn on each monthly payment. On our Starter plan ($500 a month) that's $75 a month, about $900 over 12 months.
  - Yearly clients: you earn on the yearly payment as soon as they pay. On Starter yearly ($4,800) that's $720.
- Paid by [check / Zelle] [monthly / quarterly] for whatever you've earned.
- You tell your clients you receive a referral fee.
- The fee is for introducing WiserShifts only. It isn't tied to residents, care or any other service.
- Either of us can end this any time; fees already earned are still paid.

Signed: ____________ (WiserShifts)   ____________ ([partner])   Date: ________`,
};

module.exports = { FLAT, PERCENT };
