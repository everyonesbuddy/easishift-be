/**
 * Playbook version 13: the outreach scripts, rewritten to be said out loud.
 *
 * The rules they follow:
 *  - One idea per line. Short sentences, the way you'd talk.
 *  - Ask before you pitch: a question they can answer, then the offer.
 *  - No industry shorthand without saying what it means. "Hours per resident
 *    day" is explained the first time; overtime leads, because everyone
 *    knows what it costs.
 *  - Only what's true: no made-up customers or "most people I talk to".
 *    The Labor page and the Monday email are on paid plans (free to try);
 *    the setup and the one-page snapshot are free.
 *  - Every script ends with what to do next, in [brackets].
 *
 * Names This week depends on: "Email 2" / "Email 3" pick the follow-up,
 * "voicemail" is used for another try, and an email campaign's first script
 * with a subject is what "Email" opens.
 */

const NOT_AGENCY = "We're not an agency. It's software for your own staff.";

const SCRIPTS = {
  "calls-front-desk": [
    {
      label: "1. Front desk: find the scheduler",
      body: [
        "Hi, this is {Your name} with WiserShifts. Who makes the nurse and CNA schedule there?",
        "[They tell you.] Thanks. Is [name] around right now?",
        "[If not:] No problem. When's a good time to catch them?",
        "[Before you hang up:] And who's your director of nursing? Just so I have the right names.",
        "[Write down every name. Tick it as: Call back, with the time they gave.]",
      ].join("\n\n"),
    },
    {
      label: "2. Scheduler: open with a question",
      body: [
        "Hi [name], this is {Your name}. I make a scheduling app for nursing homes and assisted living. Can I ask you one quick thing?",
        "How long does next week's schedule take you?",
        "[Listen. Then:] What's the hardest part: call-outs, people asking for days off, or filling the weekends?",
        "[Listen. Repeat back what they said in a few words, so they know you heard it.]",
      ].join("\n\n"),
    },
    {
      label: "3. Scheduler: the offer",
      body: [
        "Here's what I'd like to do. Send me your current schedule, a photo of the paper one is fine.",
        "I'll set up next week for you in WiserShifts, free. Then we go over it together for 30 minutes.",
        "Your staff get their schedule on their phones, and when someone calls out, you can send the open shift to everyone who can take it.",
        "Want to try it for next week?",
      ].join("\n\n"),
    },
    {
      label: "4. They say yes: book it",
      body: [
        "Great. Two quick things:",
        "1. What's the best email for you? I'll send a calendar invite.\n2. What day this week or next works for 30 minutes?",
        "Before then, send me whatever you use now. I'll have it set up so we're just checking it together.",
        "[Tick it as: Booked the setup. Send \"After the call\" right away.]",
      ].join("\n\n"),
    },
    {
      label: "5. They're busy",
      body: "No problem at all. When's better, later today or tomorrow? I'll call back then. It's two minutes.\n\n[Tick it as: Call back, with that time.]",
    },
    {
      label: "6. They're not sure",
      body: "Makes sense. Can I email you our free weekly schedule template and a short page on how the setup works? I'll check in Thursday and you can tell me if it's worth 30 minutes.\n\n[Get their email. Tick it as: Call back, Thursday.]",
    },
    {
      label: "If they say \"we already have a system\"",
      body: "That makes sense, most places do. Can I ask: when someone calls out at 5 in the morning, how do you find a replacement?\n\n[Listen. If it's phone calls and texts one by one:] That's the part we make faster. If it ever gets painful, the free setup is there. What's the best email for a one-page overview?",
    },
    {
      label: "If they say \"we use an agency\"",
      body: `Got it. ${NOT_AGENCY} When a shift opens up, it goes to your own staff first, so the agency becomes the backup instead of the plan. Would that be worth a look?`,
    },
    {
      label: "If they say \"it's not my decision\"",
      body: "Good to know. Who decides on things like this, your director of nursing or the administrator? I'll reach out to them. Is it OK if I mention we spoke?\n\n[Get the name. Add them on Leaders & contacts.]",
    },
    {
      label: "Voicemail (for the scheduler)",
      body: "Hi, this is {Your name} from WiserShifts, calling for whoever makes the CNA schedule. I'd like to set up next week's schedule with you, free, so your staff get it on their phones and call-outs are easier to cover. My number is [your number]. Again, {Your name}, WiserShifts. Thanks!",
    },
    {
      label: "After the call: email them",
      subject: "Next week's schedule at {Building}",
      body: "Hi [name],\n\nThanks for your time today. As promised: [the template / the invite for (day and time)].\n\nIf it's easier, just reply with this week's schedule (a photo is fine) and I'll have it set up before we talk.\n\n{Your name}\nWiserShifts",
    },
    {
      label: "At the setup: ask about their boss",
      body: "One more thing before we finish. WiserShifts can also show your director of nursing who's about to go into overtime, before the week starts, so it can be fixed on the schedule. Would they want to see that? What's their name?\n\n[Add them on Leaders & contacts. They're your next call: \"The leadership follow-up call\".]",
    },
  ],

  "calls-leadership": [
    {
      label: "1. Their scheduler already uses WiserShifts",
      body: [
        "Hi {First name}, it's {Your name} from WiserShifts. [Scheduler's name] has been building your schedules with us.",
        "I'm calling because that same schedule can show you something useful: who's about to go into overtime this week, while there's still time to fix it, instead of finding out on payroll.",
        "Can I send you last week's numbers on one page, so you can see what it looks like? It's free.",
        "[Yes: go to \"They say yes\". No: thank them, tick it as Not interested.]",
      ].join("\n\n"),
    },
    {
      label: "2. New building: open with a question",
      body: [
        "Hi {First name}, it's {Your name} from WiserShifts. We make scheduling software for nursing homes and assisted living. Quick question:",
        "How do you find out about overtime today, before payroll or after?",
        "[Listen. Then:] If you send me one week of your schedule, I'll send back one page: the overtime that was building up, and how many staff hours you scheduled for each resident each day. That's the number your labor budget is built on. Free. Want it?",
      ].join("\n\n"),
    },
    {
      label: "3. They say yes: what to ask for",
      body: [
        "Perfect. I just need two things:",
        "1. One week of your schedule. A PDF, a spreadsheet or a photo all work.\n2. About how many residents you had that week.",
        "What's the best email? I'll send you a note now, and you can just reply with them. You'll have the page in two working days.",
        "[Tick it as: Booked. Send \"After the call\" right away.]",
      ].join("\n\n"),
    },
    {
      label: "4. Going over the page with them",
      body: [
        "[Call back after you send it. Ten minutes.]",
        "Did the page come through? The top line is your overtime for the week. Underneath is staff hours per resident each day, next to your budget if you gave me one.",
        "The thing I'd look at is [the one biggest finding, in one sentence].",
        "If you'd like this every Monday morning without asking, WiserShifts does it from the schedule your team already builds. You can try it free. Want me to set that up with [scheduler's name]?",
      ].join("\n\n"),
    },
    {
      label: "Getting past the front desk",
      body: "Hi, this is {Your name} with WiserShifts. I'm trying to reach {First name}. Is now a good time, or when's best to call back?\n\n[If they ask what it's about:] I'd like to send them a free one-page summary of overtime from their own schedule. It takes them 30 seconds to say yes or no.",
    },
    {
      label: "If they say \"we're happy with how we schedule\"",
      body: "That's great, and this isn't about changing that. The page just shows the numbers from what you already do. If everything's on target, you'll have that on one page. Want it?",
    },
    {
      label: "If they say \"there's no budget\"",
      body: "Understood. The page is free, and so is setting up the schedule. If it shows overtime you can cut, that's money back. Want me to send it?",
    },
    {
      label: "If they say \"call me next quarter\"",
      body: "Will do. Which week is best? I'll put it in my calendar.\n\n[Tick it as: Call back, with that date.]",
    },
    {
      label: "Voicemail (for the DON or administrator)",
      body: "Hi {First name}, this is {Your name} from WiserShifts. If you send me one week of {Building}'s schedule, I'll send back a one-page summary of the overtime that was building up, free. My number is [your number], or just reply to my email. Thanks!",
    },
    {
      label: "After the call: email them",
      subject: "Your one-page overtime summary for {Building}",
      body: "Hi {First name},\n\nThanks for your time today. Just reply to this email with:\n1. One week of the schedule (any format)\n2. About how many residents you had that week\n\nI'll send back one page within two working days: overtime for the week, and staff hours per resident each day.\n\n{Your name}\nWiserShifts",
    },
  ],

  "email-hprd": [
    {
      label: "Email 1",
      subject: "Staffing hours at {Building}",
      body: "Hi {First name},\n\nQuick question: do you know how many staff hours {Building} scheduled for each resident each day last week, and whether that was over budget?\n\nIt's the number your labor cost is built on, and it usually only shows up after payroll.\n\nIf you send me one week of your schedule, I'll work it out and send it back on one page, free, along with any overtime that was building up.\n\nOr work it out yourself in two minutes: {calculator link}\n\n{Your name}\nWiserShifts (scheduling software for your own staff, not an agency)",
    },
    {
      label: "Email 2 (day 4)",
      subject: "Re: Staffing hours at {Building}",
      body: "Hi {First name},\n\nA quick example of why this matters: in a 50-resident building, scheduling just 6 extra minutes per resident a day adds up to about $36,500 a year in wages (at $20 an hour).\n\nWant me to work out yours? Just reply with one week of your schedule.\n\n{Your name}",
    },
    {
      label: "Email 3 (day 9)",
      subject: "Re: Staffing hours at {Building}",
      body: "Hi {First name},\n\nLast note from me. If someone else handles the schedule or the labor budget at {Building}, who should I send this to?\n\nThanks either way,\n{Your name}",
    },
    {
      label: "When they say yes",
      subject: "Re: Staffing hours at {Building}",
      body: "Thanks, {First name}! Just send me:\n1. One week of the schedule (a photo, PDF or spreadsheet is fine)\n2. About how many residents you had that week\n\nI'll send back one page within two working days: staff hours per resident each day, and any overtime that was building up.\n\n{Your name}",
    },
    {
      label: "When they ask what it costs",
      subject: "Re: Staffing hours at {Building}",
      body: "Good question. The one-page summary is free, and so is setting up your schedule. WiserShifts itself is free for one scheduler and up to 15 staff; bigger teams and the weekly overtime reports are on paid plans, which you can try free first.\n\nWant the page first, so you can see if it's worth it?\n\n{Your name}",
    },
    {
      label: "Assisted / senior living: Email 1 (overtime)",
      subject: "Overtime at {Building} last month",
      body: "Hi {First name},\n\nQuick question: how much overtime did {Building} pay last month, and how much of it came from people calling out?\n\nIt usually only shows up when payroll closes. If you send me one week of your schedule, I'll send back one page, free: where the overtime came from, and which shifts are most likely to go uncovered next.\n\nOr see what call-outs cost you in two minutes: {call-out calculator}\n\n{Your name}\nWiserShifts (scheduling software for your own staff, not an agency)",
    },
    {
      label: "Assisted / senior living: Email 2 (day 4)",
      subject: "Re: Overtime at {Building} last month",
      body: "Hi {First name},\n\nOne example: when someone calls out of a 12-hour shift and a coworker covers it on overtime, the extra half-pay at $18 an hour is about $108, for that one shift.\n\nWant me to look at yours? Just reply with one week of your schedule.\n\n{Your name}",
    },
    {
      label: "Company with several buildings: try one building",
      subject: "One building, one month",
      body: "Hi {First name},\n\nWould you be open to trying a different way of scheduling in just one of your buildings for a month? It's free. We set it up with that building's scheduler, and you'd see its overtime and open shifts every week. Then you decide.\n\nWorth a 15-minute call?\n\n{Your name}\nWiserShifts",
    },
  ],

  "email-operator": [
    {
      label: "Email 1",
      subject: "Overtime in each of {Operator}'s buildings",
      body: "Hi {First name},\n\nHow do you find out each building's overtime: every week, or when the month closes?\n\nWiserShifts sends you and each administrator the numbers every Monday morning: overtime that's coming, call-outs, and staff hours per resident, worked out the same way in every building. The schedulers build the schedule in it, so nobody has to put a report together.\n\nWould you try it in one building for a month, free? Here's what the Monday email looks like: {/for/operators link}\n\n{Your name}\nWiserShifts",
    },
    {
      label: "Email 2 (day 5)",
      subject: "Re: Overtime in each of {Operator}'s buildings",
      body: "Hi {First name},\n\nHappy to send you a sample Monday email with made-up numbers, so you can see exactly what you'd get. Want it?\n\n{Your name}",
    },
    {
      label: "Email 3 (day 12)",
      subject: "Re: Overtime in each of {Operator}'s buildings",
      body: "Hi {First name},\n\nLast note from me. Who makes the schedule at {one of their buildings}? I'll start there, free, and you can see how it goes.\n\n{Your name}",
    },
    {
      label: "When they reply",
      subject: "Re: [their subject]",
      body: "Thanks, {First name}! Which building would be best to try it in? I'll set it up with that building's scheduler this week, free for a month, and you'll get its overtime and open shifts every Monday. Does a 15-minute call on [day] work to pick the building?\n\n{Your name}",
    },
  ],

  "calculator-followup": [
    {
      label: "Same day",
      subject: "Your [hours per resident day / call-out cost] result",
      body: "Hi {First name},\n\nHere's your result from the calculator: [their result, in one line].\n\nHow it's worked out: [the math, in two lines].\n\nIf you'd like, reply with one week of your schedule and I'll check it against what was actually worked, free.\n\n{Your name}\nWiserShifts",
    },
    {
      label: "Day 3",
      subject: "What [the number] looks like every week",
      body: "Hi {First name},\n\nThe number you worked out the other day? WiserShifts works it out for you every week, from the schedule, before the week starts.\n\nSo if it's running high, you can change next week's schedule instead of finding out from payroll.\n\n[Screenshot of the Labor page.]\n\n{Your name}",
    },
    {
      label: "Day 7",
      subject: "Every Monday for {Building}?",
      body: "Hi {First name},\n\nWould you like this number in your inbox every Monday morning for {Building}? You can try it free: https://wisershifts.com/signup\n\nOr just reply, and I'll set it up with your scheduler.\n\n{Your name}",
    },
  ],
};

/** The "how to run it" steps on the two call campaigns, in the same plain words. */
const STEPS = {
  "calls-front-desk": null, // unchanged
  "calls-leadership": [
    "Ask for the director of nursing or administrator by name.",
    "If their scheduler already uses WiserShifts: offer last week's overtime and staffing on one page.",
    "If not: ask how they find out about overtime today, then offer the same page from one week of their schedule, free.",
    "If yes: get their email, send the page within two working days, then call back for 10 minutes to go over it.",
    `Say once on every call: "${NOT_AGENCY}"`,
  ],
};

module.exports = { SCRIPTS, STEPS, NOT_AGENCY };
