/**
 * Playbook version 20: referral partners.
 *
 * People who are already inside the buildings we sell to, and trusted by
 * the owner: delegating nurses (Maryland's RN oversight for assisted living
 * and DDA homes), nurse consultants, pharmacy consultants, licensing
 * consultants, and the accountants and billing companies that serve DDA
 * providers. One partner can introduce several homes.
 *
 * The deal is simple: their client gets an extra free month (a Stripe
 * promotion code with the partner's name, which also tells us who referred
 * them), and the partner gets $250 when the client has paid 2 months. A
 * flat fee, told to the client, nothing tied to residents or care.
 */

const SEED_KEY = "referral-partners";

const PLAY = {
  seedKey: SEED_KEY,
  title: "Referral partners: nurses and consultants",
  channel: "other",
  audience: ["operator"],
  who: "Delegating nurses, nurse consultants, pharmacy and licensing consultants, and DDA billing companies who visit assisted living, group homes and DDA providers.",
  goal: "A few partners who each introduce 2 or 3 of their bigger clients. Their client gets an extra free month; they get $250 per client who pays 2 months.",
  when: "Reach out to 2 new partners a week. Check in with each active partner once a month.",
  steps: [
    "Find partners where owners already ask for help: Facebook groups (business posts like a delegating nurse's flyer), LinkedIn, state assisted living and DDA provider associations.",
    "Reach out to the business directly by email or phone, using the contact details they publish. Never pitch in a Facebook group or comment thread.",
    "Lead with their clients' problem (staffing gaps, certified staff on every shift, being survey-ready), not with the referral fee.",
    "On the first call, ask how many homes and staff their bigger clients have. Partners worth the time have clients with several homes or 20+ staff.",
    "Agree the deal on one page: extra free month for their clients, $250 per client who pays 2 months, and they tell clients they get a referral fee.",
    "Make a Stripe promotion code with their name (e.g. SAFEHANDS) for the free month, and give them a free account to show clients.",
    "Ask for introductions to 2 or 3 named clients rather than a link to their whole list. Do the setup call with each one yourself.",
    "Pay the fee the week a referred client's second payment goes through. Log every partner and introduction here.",
    "The test: a partner who hasn't introduced anyone in 60 days gets one friendly check-in, then goes quiet.",
  ],
  volume: "2 new partners a week, plus a monthly check-in with each active partner.",
  weeklyTarget: 2,
  targetUnit: "partners contacted",
  countsFrom: "activities",
  measure: "Introductions made, and referred clients who pay 2 months.",
};

const SCRIPTS = [
  {
    label: "First email · Delegating nurse or nurse consultant",
    subject: "Helping your clients keep certified staff on every shift",
    body: `Hi [name],

I came across [your post / your business] and your focus on keeping agencies survey-ready caught my eye, because it's the same problem we work on from the scheduling side.

I run WiserShifts, scheduling and time tracking for 24/7 care teams: assisted living, DDA group homes and behavioral health. A few things that line up with your work:

- Only certified staff can be put on a med tech shift, and only they get texted when one opens up
- Shows certifications that have expired or expire in the next 30 days, every week
- Fills call-outs by text: staff reply YES and the shift is theirs, so homes aren't left short overnight

I'd love to show you a 15-minute demo. If it would help your clients, I'd like to set up a simple referral arrangement: your clients get an extra free month, and you get $250 for each one who signs on.

One quick question to see if it's a fit: roughly how many homes and staff do your larger clients have?

Would a call sometime next week work?

Thanks,
[your name]
WiserShifts`,
  },
  {
    label: "First email · Short version",
    subject: "Referral partnership: WiserShifts + [their business]",
    body: `Hi [name],

I think we serve the same providers. I run WiserShifts, staff scheduling for assisted living and DDA homes: only certified staff go on med tech shifts, expiring certifications show every week, and call-outs get filled by text.

I'd like to offer your clients an extra free month, and pay you $250 for each one who signs on. Do you have 15 minutes next week for a quick demo?

Thanks,
[your name]
WiserShifts`,
  },
  {
    label: "Follow-up · Once, after 5 days",
    subject: "Re: [original subject]",
    body: `Hi [name], just following up on my note about WiserShifts for your clients. Happy to do a quick 15-minute demo whenever suits, or to send a short video if that's easier.`,
  },
  {
    label: "Call · Questions to ask",
    body: `1. How many clients do you work with, and what kinds (assisted living, DDA, home care)?
2. Roughly how many homes and staff do your bigger clients have?
3. What staffing problems do you see most when you visit? (call-outs, no certified staff on a shift, overtime, expired certifications)
4. How do they schedule today? (paper, whiteboard, group chat, other software)
5. Which 2 or 3 clients would get the most out of this? Would you be comfortable introducing us?`,
  },
  {
    label: "The deal · One page",
    body: `WiserShifts referral partnership

- Your clients: an extra free month when they sign up with code [CODE].
- You: $250 for each client who signs up with your code and pays for 2 months, paid by [check / Zelle] the following week.
- You tell your clients you receive a referral fee.
- The fee is for introducing WiserShifts only. It isn't tied to residents, care or any other service.
- Either of us can end this any time; fees already earned are still paid.

Signed: ____________ (WiserShifts)   ____________ ([partner])   Date: ________`,
  },
  {
    label: "Introduction · For the partner to send their client",
    body: `Hi [client name],

I wanted to introduce you to [your name] at WiserShifts. They make scheduling software for homes like yours: it keeps certified staff on med tech shifts, flags expiring certifications, and fills call-outs by text.

They're offering my clients an extra free month with the code [CODE]. Worth a 15-minute look.

[partner name]`,
  },
  {
    label: "Monthly check-in · Active partner",
    body: `Hi [name], quick check-in from WiserShifts. [Client] is up and running and [one result, e.g. filled 4 call-outs by text this month]. Thanks again for the introduction.

Anyone else you visit who's struggling with call-outs or keeping certified staff on every shift? Happy to do the setup with them myself.`,
  },
];

module.exports = { SEED_KEY, PLAY, SCRIPTS };
