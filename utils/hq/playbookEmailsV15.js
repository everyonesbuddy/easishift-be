/**
 * Playbook version 15: the cold emails, with names that say what's going on.
 *
 * Every name reads "Which · When · What it does", for example
 * "Email 2 · Day 4, if no reply · A quick cost example". This week still
 * finds the follow-ups by "Email 2" / "Email 3", and the versions for
 * assisted living by "assisted living" (picked when the building's type says so).
 *
 * Every first email says who you are in one line, asks one question, and
 * makes one free offer. Follow-ups are short and say they're a follow-up.
 * [Square brackets] are for you to fill in; {curly} ones fill in themselves.
 */

const SIGN = "{Your name}\nWiserShifts, scheduling software for your own staff (not an agency)";

const EMAIL_HPRD = [
  {
    label: "Email 1 · Day 1 · Ask about their staffing hours",
    subject: "Staffing hours at {Building}",
    body: `Hi {First name},

I'm {Your name}, and I make WiserShifts, a scheduling app for nursing homes. One quick question:

Do you know how many staff hours {Building} scheduled for each resident each day last week, and whether that was over budget?

That number drives your labor cost, and it often only shows up after payroll closes.

If you send me one week of your schedule, I'll work it out and send it back on one page, free, along with any overtime that was building up. Or work it out yourself in two minutes: {calculator link}

${SIGN}`,
  },
  {
    label: "Email 2 · Day 4, if no reply · A quick cost example",
    subject: "Re: Staffing hours at {Building}",
    body: `Hi {First name},

Following up on my note about staffing hours. Here's why it's worth knowing: in a 50-resident building, scheduling just 6 extra minutes per resident a day adds up to about $36,500 a year in wages (at $20 an hour).

Want me to work out yours? Just reply with one week of your schedule, in any format.

{Your name}`,
  },
  {
    label: "Email 3 · Day 9, if no reply · Ask who else to talk to (last email)",
    subject: "Re: Staffing hours at {Building}",
    body: `Hi {First name},

Last note from me. If the schedule or the labor budget at {Building} is someone else's job, who should I send this to?

Thanks either way,
{Your name}`,
  },
  {
    label: "Reply · They said yes · Ask for the schedule",
    subject: "Re: Staffing hours at {Building}",
    body: `Thanks, {First name}! Just send me:

1. One week of the schedule (a photo, PDF or spreadsheet is fine)
2. About how many residents you had that week

I'll send back one page within two working days: staff hours per resident each day, and any overtime that was building up.

{Your name}`,
  },
  {
    label: "Reply · They asked what it costs",
    subject: "Re: Staffing hours at {Building}",
    body: `Good question, {First name}. The one-page summary is free, and so is setting up your schedule.

WiserShifts itself is free for one scheduler and up to 15 staff. Bigger teams and the weekly overtime reports are on paid plans, which you can try free first.

Want the page first, so you can see if it's worth it?

{Your name}`,
  },
  {
    label: "Reply · They said not now",
    subject: "Re: Staffing hours at {Building}",
    body: `No problem at all, {First name}. Thanks for letting me know.

If overtime ever becomes a headache, the calculator is free any time: {calculator link}

{Your name}

[Tick it as: Not interested, so the follow-ups stop.]`,
  },
  {
    label: "Reply · They pointed you to someone else",
    subject: "Re: Staffing hours at {Building}",
    body: `Thanks, {First name}, that helps. I'll reach out to [their name]. Is it OK if I mention you pointed me their way?

{Your name}

[Add them on Leaders & contacts, then email them with Email 1.]`,
  },
  {
    label: "Assisted living · Email 1 · Day 1 · Ask about overtime",
    subject: "Overtime at {Building} last month",
    body: `Hi {First name},

I'm {Your name}, and I make WiserShifts, a scheduling app for assisted living and senior care. One quick question:

How much overtime did {Building} pay last month, and how much of it came from people calling out?

It often only shows up when payroll closes. If you send me one week of your schedule, I'll send back one page, free: where the overtime came from, and which shifts are most likely to go uncovered next. Or see what call-outs cost you in two minutes: {call-out calculator}

${SIGN}`,
  },
  {
    label: "Assisted living · Email 2 · Day 4, if no reply · The cost of one call-out",
    subject: "Re: Overtime at {Building} last month",
    body: `Hi {First name},

Following up on my note about overtime. One example: when someone calls out of a 12-hour shift and a coworker covers it on overtime, the extra half-pay at $18 an hour is about $108, for that one shift.

Want me to look at yours? Just reply with one week of your schedule.

{Your name}`,
  },
];

const EMAIL_OPERATOR = [
  {
    label: "Email 1 · Day 1 · Ask how they see overtime across buildings",
    subject: "Overtime across your buildings",
    body: `Hi {First name},

I'm {Your name}, and I make WiserShifts, a scheduling app for nursing homes and assisted living. One quick question:

How do you find out each building's overtime: every week, or when the month closes?

WiserShifts sends you and each administrator the numbers every Monday morning: overtime that's coming, call-outs, and staff hours per resident, worked out the same way in every building. The schedulers build the schedule in it, so nobody has to put a report together.

Would you try it in one building for a month, free? Here's what the Monday email looks like: {operators link}

${SIGN}`,
  },
  {
    label: "Email 2 · Day 5, if no reply · Offer a sample Monday email",
    subject: "Re: Overtime across your buildings",
    body: `Hi {First name},

Following up on my note. Happy to send you a sample Monday email with made-up numbers, so you can see exactly what you and your administrators would get. Want it?

{Your name}`,
  },
  {
    label: "Email 3 · Day 12, if no reply · Ask who makes one building's schedule (last email)",
    subject: "Re: Overtime across your buildings",
    body: `Hi {First name},

Last note from me. Who makes the schedule at [one of their buildings]? I'll start there, free, and you can see how it goes.

{Your name}`,
  },
  {
    label: "Reply · They're interested · Pick the building",
    subject: "Re: Overtime across your buildings",
    body: `Thanks, {First name}! Which building would be best to try it in?

I'll set it up with that building's scheduler this week, free for a month, and you'll get its overtime and open shifts every Monday. Does a 15-minute call on [day] work to pick the building?

{Your name}`,
  },
  {
    label: "Reply · They said not now",
    subject: "Re: Overtime across your buildings",
    body: `Understood, {First name}. Thanks for the reply. If it ever helps, the offer to try one building free stands.

{Your name}

[Tick it as: Not interested, so the follow-ups stop.]`,
  },
];

const CALCULATOR_FOLLOWUP = [
  {
    label: "Email 1 · Same day · Their calculator result",
    subject: "Your [hours per resident day / call-out cost] result",
    body: `Hi {First name},

Here's your result from the calculator: [their result, in one line].

How it's worked out: [the math, in two lines].

If you'd like, reply with one week of your schedule and I'll check it against what was actually worked, free.

{Your name}
WiserShifts`,
  },
  {
    label: "Email 2 · Day 3 · What it looks like every week",
    subject: "What [the number] looks like every week",
    body: `Hi {First name},

The number you worked out the other day? WiserShifts works it out for you every week, from the schedule, before the week starts.

So if it's running high, you can change next week's schedule instead of finding out from payroll.

[Screenshot of the Labor page.]

{Your name}`,
  },
  {
    label: "Email 3 · Day 7 · Ask if they want it every Monday",
    subject: "Every Monday for {Building}?",
    body: `Hi {First name},

Would you like this number in your inbox every Monday morning for {Building}? You can try it free: {signup link}

Or just reply, and I'll set it up with your scheduler.

{Your name}`,
  },
];

const SCRIPTS = { "email-hprd": EMAIL_HPRD, "email-operator": EMAIL_OPERATOR, "calculator-followup": CALCULATOR_FOLLOWUP };

module.exports = { SCRIPTS };
