/**
 * Playbook version 14: the leadership call assumes nothing. The list is
 * leaders at buildings that aren't customers, so the first call opens with a
 * question. The "you spoke with their scheduler" version is only for when
 * HQ shows a logged call with the scheduler there (This week opens it then).
 */
const { NOT_AGENCY } = require("./playbookScriptsV13");

const LEADERSHIP = [
  {
    label: "1. First call: open with a question",
    body: [
      "Hi {First name}, it's {Your name} from WiserShifts. We make scheduling software for nursing homes and assisted living. Do you have 30 seconds?",
      "How do you find out about overtime today: before payroll, or after?",
      "[Listen. Then:] If you send me one week of your schedule, I'll send back one page: the overtime that was building up, and how many staff hours you scheduled for each resident each day. That's the number your labor budget is built on. It's free. Want it?",
      "[Yes: go to \"They say yes\". No: thank them, tick it as Not interested.]",
    ].join("\n\n"),
  },
  {
    label: "2. They say yes: what to ask for",
    body: [
      "Perfect. I just need two things:",
      "1. One week of your schedule. A PDF, a spreadsheet or a photo all work.\n2. About how many residents you had that week.",
      "What's the best email? I'll send you a note now, and you can just reply with them. You'll have the page in two working days.",
      "[Tick it as: Booked. Send \"After the call\" right away.]",
    ].join("\n\n"),
  },
  {
    label: "3. Going over the page with them",
    body: [
      "[Call back after you send it. Ten minutes.]",
      "Did the page come through? The top line is your overtime for the week. Underneath is staff hours per resident each day, next to your budget if you gave me one.",
      "The thing I'd look at is [the one biggest finding, in one sentence].",
      "WiserShifts can send you this every Monday morning. Your scheduler builds the schedule in it, and the numbers come from that. You can try it free. Would you like me to set it up with whoever does your schedule?",
    ].join("\n\n"),
  },
  {
    label: "If you've already spoken with their scheduler",
    body: [
      "[Only use this if HQ shows a call where you talked with the scheduler at this building. Check the notes for their name and what you agreed.]",
      "Hi {First name}, it's {Your name} from WiserShifts. I spoke with [scheduler's name] [when] about your schedule[, and we're setting up next week together].",
      "I wanted to call you too, because the schedule can also show you who's about to go into overtime, while there's still time to fix it, instead of finding out on payroll.",
      "Can I send you one page with last week's numbers, so you can see what that looks like? It's free.",
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
    body: "Hi {First name}, this is {Your name} from WiserShifts. We make scheduling software for nursing homes and assisted living. If you send me one week of {Building}'s schedule, I'll send back a one-page summary of the overtime that was building up, free. My number is [your number]. Thanks!",
  },
  {
    label: "After the call: email them",
    subject: "Your one-page overtime summary for {Building}",
    body: "Hi {First name},\n\nThanks for your time today. Just reply to this email with:\n1. One week of the schedule (any format)\n2. About how many residents you had that week\n\nI'll send back one page within two working days: overtime for the week, and staff hours per resident each day.\n\n{Your name}\nWiserShifts",
  },
];

const STEPS = [
  "Before you dial, read what HQ knows about them on the call (past calls, notes, the scheduler's name). No history means a first call.",
  "First call: ask how they find out about overtime today, then offer the free one-page summary from one week of their schedule.",
  "Only if you've already talked with their scheduler: say so, and offer the same page.",
  "If yes: get their email, send the page within two working days, then call back for 10 minutes to go over it.",
  `Say once on every call: "${NOT_AGENCY}"`,
];

const WHO = "The DON or administrator at a building that isn't a customer yet.";
const WHEN = "Any time. It lands best after you've talked with their scheduler, or after they clicked an email or used a calculator. HQ shows which on each call.";

module.exports = { LEADERSHIP, STEPS, WHO, WHEN };
