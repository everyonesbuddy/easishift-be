/**
 * Playbook version 11: calls and cold emails follow what happens.
 *  - FOLLOW_UPS: the days after the first email that email 2 and 3 go out.
 *  - CALL_SCRIPTS: what to say in each situation on a call, in the order a
 *    call goes (who you reach, what they say, the voicemail, the push-back,
 *    and the email after). Added after your scripts, skipping any with the
 *    same name. {Building}, {First name} and {Your name} fill in on This week.
 */
const FOLLOW_UPS = { "email-hprd": [4, 9], "email-operator": [5, 12] };

const CALL_SCRIPTS = {
  "calls-front-desk": [
    { label: "1. Front desk: ask for the scheduler", body: "Hi, this is {Your name} with WiserShifts. Who builds the CNA schedule there?\n\n[They tell you.] Great. Is [name] around, or is there a better time to catch them?\n\n[If not around:] No problem. What's the best number or time? I'll call back then." },
    { label: "2. Reached the scheduler: the first 30 seconds", body: "Hi [name], this is {Your name} with WiserShifts. Quick one: you build the schedule at {Building}, right?\n\nWe make a scheduling tool for CNA and nursing teams. I'd like to build next week's schedule with you, free, about 30 minutes. You send me who works and what you need per shift, and your staff get their schedule on their phone.\n\nWould that help, or is the schedule under control right now?" },
    { label: "3. They're interested: book the setup", body: "Great. Two things and I'll let you go:\n\n1. What's the best email for you? I'll send a calendar invite.\n2. What day works for 30 minutes this week or next?\n\nBefore the call, send me whatever you use now (a spreadsheet, a photo of the paper schedule, anything). I'll have it set up so we're just checking it together.\n\n[Tick it as: Booked the setup.]" },
    { label: "4. They're busy right now", body: "Totally understand. When's a better time, today or tomorrow? I'll call back then. It's two minutes.\n\n[Tick it as: Call back, with that date.]" },
    { label: "5. They want to think about it", body: "Makes sense. Can I email you the free weekly schedule template and a one-page overview? I'll check in Thursday to see if a setup would help.\n\n[Tick it as: Call back, Thursday.]" },
    { label: "Pushback: \"not my decision\"", body: "Good to know. Who decides on scheduling tools there, your DON or the administrator? I'll reach out to them, and is it OK if I mention we spoke?\n\n[Get the name. Add them on Leaders & contacts.]" },
    { label: "After the call: confirm by email", subject: "Next week's schedule at {Building}", body: "Hi [name],\n\nThanks for the time today. As promised: [the template / the invite for (day and time)].\n\nIf it's easier, just reply with this week's schedule (a photo is fine) and I'll have it set up before we talk.\n\n{Your name}, WiserShifts" },
  ],
  "calls-leadership": [
    { label: "1. Gatekeeper (administrator's office)", body: "Hi, this is {Your name} with WiserShifts. I'm trying to reach {First name} about labor and overtime reporting for {Building}. Is now a good time, or when's best to call back?\n\n[If they ask what it's about:] We send a one-page snapshot of hours per resident day and overtime from a building's own schedule. It's free, and it takes them 30 seconds to say yes or no." },
    { label: "2. Reached the DON or ED: the snapshot ask", body: "Hi {First name}, {Your name} with WiserShifts. Thirty seconds, I promise.\n\nDo you know {Building}'s hours per resident day last week, and how it compared to budget? Most leaders find out a month later from payroll.\n\nIf you send me one week of your schedule, I'll send back one page: hours per resident day by day and any overtime that's coming. Free. Want me to?" },
    { label: "3. They say yes: what to ask for", body: "Perfect. All I need is:\n\n1. One week of the schedule (PDF, spreadsheet or a photo).\n2. Your average census that week.\n\nWhat's the best email? I'll send you a note now so you can just reply with it. You'll have the page within two working days.\n\n[Tick it as: Booked. Then send \"After the call: confirm the snapshot\".]" },
    { label: "Pushback: \"we're happy with how we schedule\"", body: "That's great to hear, and this isn't about changing that. The snapshot just shows the numbers from what you already do. If it's all on target, you'll have that on one page. Worth a look?" },
    { label: "Pushback: \"call me next quarter\"", body: "Will do. Is there a better week? I'll put it in my calendar. And in the meantime, the hours per resident day calculator is free if you want to check a week yourself.\n\n[Tick it as: Call back, with that date.]" },
    { label: "After the call: confirm the snapshot", subject: "Your labor snapshot for {Building}", body: "Hi {First name},\n\nThanks for the time today. Just reply to this email with:\n1. One week of the schedule (any format)\n2. Your average census that week\n\nI'll send back one page within two working days: hours per resident day by day, and any overtime that's coming.\n\n{Your name}, WiserShifts" },
  ],
};

module.exports = { FOLLOW_UPS, CALL_SCRIPTS };
