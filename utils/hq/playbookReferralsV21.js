/**
 * Playbook version 21: referral partners for anyone, not just nurses.
 *
 * Anyone owners already trust can introduce us: happy customers, nurse
 * and pharmacy consultants, coaches who teach people to open a group home,
 * training schools, payroll and billing firms, insurance brokers, other
 * software vendors, attorneys and associations. One generic first email
 * fits all of them; [what they do] is the only part to fill in.
 */

const TITLE = "Referral partners";

const WHO =
  "Anyone owners of 24/7 care homes already trust: happy customers, nurse and pharmacy consultants, group home and assisted living coaches, CNA/CMT/DSP training schools, payroll and billing firms, insurance brokers, other software vendors, healthcare attorneys and provider associations.";

const GOAL = "3 to 5 partners who each introduce 2 or 3 good clients. Their client gets an extra free month; they get $250 once per client who pays 2 months.";

const STEPS = [
  "Look for people who work with many care homes: happy customers, consultants, coaches, training schools, payroll and billing firms, insurance brokers, software vendors, associations. Add each one on HQ's Referral partners page with their type.",
  "Find them where owners ask for help: Facebook groups (business posts), LinkedIn, YouTube, association member and vendor lists, and our own customers.",
  "Reach out to the business directly by email or phone, using the contact details they publish. Never pitch in a Facebook group or comment thread.",
  "Lead with their clients' problem (call-outs, overtime, keeping certified staff on every shift), not with the referral fee.",
  "On the first call, ask how many homes they work with and how big the larger ones are. Partners worth the time have clients with several homes or 20+ staff.",
  "Agree the deal on one page: extra free month for their clients, $250 once per client who pays 2 months, and they tell clients they get a referral fee.",
  "Give them a code (e.g. SAFEHANDS), make it in Stripe, and send them their signup link from the partner page.",
  "Ask for introductions to 2 or 3 named clients rather than a link to their whole list. Do the setup call with each one yourself.",
  "Pay the fee when the partner page says it's due, then mark it paid. Log every email and call on the partner page.",
  "The test: a partner who hasn't introduced anyone in 60 days gets one friendly check-in, then goes quiet.",
];

const SCRIPTS = [
  {
    label: "First email · Any partner",
    subject: "Something your clients might find useful",
    body: `Hi [name],

I came across [how you found them] and saw you work with [assisted living / group home / DDA] providers, which is exactly who we build for.

I run WiserShifts, scheduling and time tracking for 24/7 care teams. For the homes you work with, it:

- Fills call-outs by text: staff reply YES and the shift is theirs, so nobody is left short overnight
- Puts only certified staff on med tech shifts, and shows certifications that are about to expire
- Catches overtime before it happens, and exports hours for payroll

If it would help your clients, I'd like to set up a simple referral arrangement: your clients get an extra free month, and you get $250 for each one who signs on.

Roughly how many homes do you work with, and how big are the larger ones? Happy to show you a 15-minute demo next week if it's a fit.

Thanks,
[your name]
WiserShifts`,
  },
  {
    label: "First email · A happy customer",
    subject: "Quick favor (and a thank-you)",
    body: `Hi [name],

Thanks again for using WiserShifts at [their facility]. [One result, e.g. "You filled 6 call-outs by text last month."]

Do you know another owner or scheduler who's fighting the same staffing headaches? If you introduce us, they get an extra free month, and we'll send you $250 once they've been with us 2 months.

Your code is [CODE], or just forward them this link: [signup link].

Thanks,
[your name]`,
  },
  {
    label: "Follow-up · Once, after 5 days",
    subject: "Re: [original subject]",
    body: `Hi [name], just following up on my note about WiserShifts for your clients. Happy to do a quick 15-minute demo whenever suits, or to send a short video if that's easier.`,
  },
  {
    label: "Call · Questions to ask",
    body: `1. Who do you work with, and how many homes or facilities (assisted living, group homes, DDA, behavioral health)?
2. Roughly how big are the larger ones (homes, staff)?
3. What staffing problems do you hear about most? (call-outs, overtime, no certified staff on a shift, expired certifications)
4. How do they schedule today? (paper, whiteboard, group chat, other software)
5. Which 2 or 3 clients would get the most out of this? Would you be comfortable introducing us?`,
  },
  {
    label: "The deal · One page",
    body: `WiserShifts referral partnership

- Your clients: an extra free month when they sign up with code [CODE] (or your link: [signup link]).
- You: $250 once for each client who signs up with your code and pays for 2 months, paid by [check / Zelle] the following week.
- You tell your clients you receive a referral fee.
- The fee is for introducing WiserShifts only. It isn't tied to residents, care or any other service.
- Either of us can end this any time; fees already earned are still paid.

Signed: ____________ (WiserShifts)   ____________ ([partner])   Date: ________`,
  },
  {
    label: "Introduction · For the partner to send their client",
    body: `Hi [client name],

I wanted to introduce you to [your name] at WiserShifts. They make scheduling software for 24/7 care homes like yours: it fills call-outs by text, keeps certified staff on med tech shifts and catches overtime before it happens.

They're offering my clients an extra free month with the code [CODE], or through this link: [signup link]. Worth a 15-minute look.

[partner name]`,
  },
  {
    label: "Monthly check-in · Active partner",
    body: `Hi [name], quick check-in from WiserShifts. [Client] is up and running and [one result, e.g. filled 4 call-outs by text this month]. Thanks again for the introduction.

Anyone else you work with who's struggling with call-outs or overtime? Happy to do the setup with them myself.`,
  },
];

module.exports = { TITLE, WHO, GOAL, STEPS, SCRIPTS };
