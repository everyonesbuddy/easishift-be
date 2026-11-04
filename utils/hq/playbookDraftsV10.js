/**
 * Playbook version 10: reference drafts so every play is easy to run.
 *  - DRAFTS: a working draft or script for every seeded content piece that
 *    only had a title (LinkedIn posts, newsletters, videos, the blog post,
 *    the templates, Facebook posts). They land in the piece's notes, and
 *    only where the notes were never edited.
 *  - NEW_ITEMS: two more newsletters, so leaders' and schedulers' weeks
 *    each have a ready draft.
 *  - SCRIPTS: templates for the content plays (post formula, video script,
 *    blog outline, newsletter layout), the calculator follow-up emails,
 *    voicemails and answers to the usual push-back on calls, and what to
 *    send when a cold email gets a reply.
 * Placeholders like {First name}, {Building}, {calculator link} fill in on
 * This week; [square brackets] are for you to fill.
 */

const D = (s) => s.replace(/^\n/, "").replace(/\n\s+$/, "");

const DRAFTS = {
  // LinkedIn: one number, the math in three lines, one thing to do. Link in the first comment.
  "li-tenth": D(`
What 0.1 hours per resident day costs a 50-bed building:

0.1 hours × 50 residents × 365 days = 1,825 hours a year.
At $20 an hour, that's $36,500 in wages.

That's six minutes per resident per day. Easy to drift into without noticing: one extra person on a lighter day, an overtime shift that could have been straight time.

The fix isn't cutting care. It's seeing the number every week instead of at month-end, so you change next week's schedule instead of explaining last month's.

Do you know your building's number for last week?

First comment: Free hours per resident day calculator: {calculator link}
Visual: the three lines of math on a plain card.
`),
  "li-ot-late": D(`
Overtime gets decided on a Tuesday and discovered two weeks later.

Here's how it usually happens: a midweek call-out gets covered by whoever says yes first. By Thursday that person is at 40 hours, and their Friday shift is all overtime. Nobody planned it. The schedule just didn't show it.

Payroll shows it after the pay period closes. By then it's history.

One thing to do: before you fill a call-out, check how many hours the person already has this week. If the shift takes them past 40, ask the next person first.

How do you check hours before you fill a call-out?

First comment: What call-outs cost your building: {call-out calculator}
`),
  "li-staffed-needed": D(`
Under budget and short-staffed, on the same day. It happens more than you'd think.

Budget looks at hours staffed. Residents feel hours needed.

Say today's census and acuity call for 130 nursing hours and 120 are scheduled. On paper you're 10 hours under budget. On the floor, someone is skipping a break.

One thing to do: track both every day, hours scheduled and hours needed for today's census. The gap is where call-outs, burnout and overtime start.

How does your building set "hours needed"?
`),
  "li-fte": D(`
How many full-time CNAs does a 3-shift building need?

Say you need 6 on days, 5 on evenings and 3 on nights: 14 shifts a day, 98 a week.
At 5 shifts per full-time person, that's 19.6 people.
Add 10% for time off, sick days and training: about 22.

A lot of buildings staff to 19 or 20 and cover the rest with overtime and agency. That gap is the real cost.

Do yours: shifts per day × 7 ÷ 5, then add 10%. How close is your headcount?
`),
  "li-quit-signs": D(`
Three signs someone is about to quit, and all three show up in the schedule first:

1. Call-outs creeping up: one a month becomes one a week.
2. Overtime streaks: the person who always says yes, three weeks running.
3. Hours dropping off: they stop picking up the extra shifts they used to want.

None of these means they're leaving. Each one is a reason for a 5-minute conversation this week, not an exit interview next month.

Which one do you usually notice first?
`),
  "li-sunday": D(`
A scheduler's Sunday, before:
2 p.m., spreadsheet open. Copy last week's tab. Fix the four people who asked off (one request is on a sticky note, one is in a text from Thursday). Find cover for Monday's two call-outs. Print, post, text a photo to the group chat. Answer "what time am I on Tuesday?" until 9 p.m.

After:
Next week starts from this week. Requests are already on it. Open shifts are easy to see. Publish, and everyone gets their own schedule.

Same scheduler. Different Sunday.

Schedulers: what does your Sunday look like?

(Close to Post 1. Use one or the other, not both in the same month.)
`),
  "li-certs": D(`
CNA certifications don't expire loudly.

Nobody gets an alert. The schedule keeps putting the person on the floor. Then a survey, an audit or an HR check finds it.

A 30-day warning buys time to renew without pulling them off the schedule, and saves the scramble of covering their shifts at the last minute.

One thing to do this week: list every license and certification with its expiry date, soonest first. Anything due in the next 30 days, start the renewal now.

How do you keep track of these today?
`),

  // Klaviyo: one idea per email, alternating leaders and schedulers.
  "nl-1": D(`
Leaders' week. Send Tuesday morning.

Subject: What 0.1 hours per resident day costs a 50-bed building
Preview text: $36,500 a year, from six minutes per resident.

Hi {First name},

One number this week.

In a 50-bed building, 0.1 hours per resident day is:
0.1 × 50 residents × 365 days = 1,825 hours a year.
At $20 an hour, that's $36,500 in wages.

That's six minutes per resident per day. It's easy to drift that far: one extra person on a lighter day, or an overtime shift that could have been straight time.

The fix is seeing your number every week instead of at month-end, so next week's schedule changes, not last month's report.

Two ways to get yours:
- Try the calculator (2 minutes): {calculator link}
- Or reply "snapshot" and I'll work it out from one week of your schedule, free.

{Your name}
WiserShifts
`),
  // YouTube: one problem, solved on screen, titled the way a scheduler searches.
  "yt-callout": D(`
Title (search): How to cover a call-out in 5 minutes (without calling everyone)

Hook (0–10s): "It's 5 a.m., someone just called out, and the shift starts at 6. Here's how to cover it in five minutes without calling the whole list."

1. Find the open shift on today's schedule. Show it.
2. Narrow it to people who are qualified for that role and unit and not about to go over 40 hours. Say why the hours matter (overtime).
3. Send it to all of them at once, not one by one.
4. The first qualified yes takes it. The schedule updates, and everyone else sees it's covered.
5. The spreadsheet way, for anyone not using software: a "who can cover" list by shift, kept next to the schedule.

Close: "The call-out cost calculator and a printable call-out log are in the description. If you want this on your real schedule, start free at wisershifts.com."

Description: Call-out cost calculator: {call-out calculator} · Weekly schedule template: {template link} · Start free: {signup link}
`),
  "yt-next-week": D(`
Title (search): How to build next week's CNA schedule in 10 minutes

Hook: "Building next week's schedule shouldn't take your whole Sunday. Here's the order that makes it ten minutes."

1. Start from this week, not a blank sheet.
2. Put in the approved time off first.
3. Check coverage shift by shift: how many you have vs how many you need.
4. Fill the gaps with people who are under their hours.
5. Check the hours column for anyone over 40.
6. Publish. If one unit is ready before the others, send that one now.

Close: "The printable weekly template is in the description, free. Or start free in WiserShifts and I'll build your first week with you."

Description: Template: {template link} · Start free: {signup link}
`),
  "yt-weekend": D(`
Title (search): A fair weekend rotation for CNAs (that staff won't fight over)

Hook: "Weekends cause more fights than any other shift. Here's a rotation people actually accept."

1. Every other weekend as the standard, and say it out loud.
2. Split the team into A and B weekends, balanced by role and experience.
3. Post it 4 to 6 weeks ahead so people can plan around it.
4. Swaps are fine if it's like for like (a CNA for a CNA) and you approve them.
5. Keep a tally of extra weekends worked, and give those people first pick on time off.

Show: building the A and B pattern on screen, then copying it forward.
Close: "Template in the description. Start free at wisershifts.com."
`),
  "yt-staff-link": D(`
Turns Post 4 into a 2-minute screen recording.

Title (search): How staff see their schedule without an app

Hook: "Half your staff won't download another app. They don't need to."

1. Publish the week.
2. Each person gets their own link to their schedule (show where it goes out from).
3. Open the link on a phone: their shifts, and open shifts they can pick up.
4. Show what changes for the scheduler: no "what time am I on?" texts.

Close: "Start free at wisershifts.com." Record it on a real phone screen.
`),
  "yt-publish-unit": D(`
From Post 5. Show the Publish sheet with one area picked.

Title (search): How to send one unit's schedule before the rest is done

Hook: "One unit is done, the other two aren't. Don't make that unit wait. Send it now."

1. Open Publish.
2. Pick the one area that's ready.
3. Publish. Those staff get their schedule, and the rest stays in draft.
4. Show that the drafted shifts still show as drafted, so nobody mistakes them for final.

Close: "Start free at wisershifts.com."
`),
  "yt-swaps": D(`
From Post 11. Holiday timing: post it in early December.

Title (search): How to handle shift swaps without the group chat

Hook: "Holiday swap requests buried in a 40-person group chat? Move them to one place."

1. A staff member asks to swap from their own link.
2. The other person agrees.
3. You approve it (or don't), and the schedule updates for both.
4. Show what you can see: who swapped what, and when.

Check the exact steps on screen before recording.
Close: "Start free at wisershifts.com."
`),
  "yt-time-off": D(`
From Post 12.

Title (search): How to track CNA time-off requests (no sticky notes)

Hook: "A sticky note, a text from Thursday, and a hallway conversation. Three time-off requests, zero in one place."

1. Staff send a request from their own link.
2. You see it on the calendar while you build the schedule.
3. Approve or decline, and they're told either way.
4. Next week's schedule already shows who's off.

Close: "Start free at wisershifts.com."
`),
  "yt-first-week": D(`
The free-setup offer on video (Post 15).

Title (search): Set up your first week of scheduling in 10 minutes

Hook: "Ten minutes from nothing to a published schedule. Here's the whole thing, start to send."

1. Add your staff (type them in or import).
2. Set your shifts and how many people each one needs.
3. Build the week.
4. Publish.

Close: "If you'd rather not do it alone, I'll build your first week with you, free. Book it at wisershifts.com."
`),
  "short-5am": D(`
Cut from the call-out video for YouTube Shorts and Facebook. 30 seconds, vertical.

0–3s, text on screen: 5:04 a.m. "Can't make it today."
3–12s: Scrolling contacts. Texting one person, then the next. "Before."
12–25s: One tap. The open shift goes out, someone picks it up, the schedule updates. "After."
25–30s: "Covering a call-out shouldn't take an hour. WiserShifts. Free to start."

Caption: Call-outs will always happen. Covering them shouldn't take an hour.
`),
  "short-sunday": D(`
From Post 1. 30 seconds, vertical.

0–3s, text on screen: Sunday, 2 p.m.
3–13s: Spreadsheet, sticky notes, the group chat filling up. "Before."
13–25s: Copy last week, requests already on it, Publish. "After."
25–30s: "Same scheduler. Different Sunday. WiserShifts. Free to start."
`),

  // Search: one search per piece, ending with the matching calculator and Start free.
  "blog-hprd": D(`
For the search: "how to calculate hours per resident day", "HPRD formula".

1. What it is (one paragraph): total nursing hours worked in a day, divided by the number of residents that day.

2. The formula:
Hours per resident day = (RN hours + LPN hours + CNA hours worked) ÷ residents

3. Worked example, 60 residents:
- Days: 1 RN (8 h), 2 LPNs (16 h), 6 CNAs (48 h) = 72 hours
- Evenings: 1 RN (8 h), 2 LPNs (16 h), 5 CNAs (40 h) = 64 hours
- Nights: 1 RN (8 h), 1 LPN (8 h), 3 CNAs (24 h) = 40 hours
Total: 176 hours ÷ 60 residents = 2.93 hours per resident day.

4. What counts: hours actually worked by direct-care nursing staff. Check your state's rules and how you report to CMS (Payroll-Based Journal) for what's included.

5. Use it before the week, not after: hours you need = your target × tomorrow's census. Compare that to what's scheduled.

6. Common mistakes: using scheduled hours instead of worked hours, the wrong day's census, counting orientation or admin time.

7. End: "Work out yours in 2 minutes" → {calculator link}, then Start free.
`),
  "tpl-weekly": D(`
Copy for the template's page and the blog post that goes with it.

Title: Free printable weekly CNA schedule template (PDF and Excel)

What's in it: shift codes, a coverage check for each shift, and an hours column that flags overtime.

How to use it:
1. Write your staff down the left, by role.
2. Fill in shift codes for the week.
3. Check the coverage row: does each shift have enough people?
4. Check the hours column: anyone over 40?
5. Print it and post it, or share the PDF.

Links: PDF {template link} · Excel https://wisershifts.com/templates/weekly-cna-schedule-template.xlsx
End: "When you're ready to stop rebuilding it every week: start free, and we'll build your first week with you."
`),
  "tpl-callout-log": D(`
Pairs with the call-out cost calculator. A one-page printable.

Columns: Date · Shift · Unit · Who called out · Time you were told · Who covered · Covered by (straight time / overtime / agency / left open) · Extra cost

Footer, for the month: call-outs · % covered with overtime · % agency · % left open · total extra cost

Page copy: "Most buildings don't know what call-outs cost until they add it up. Use this log for a month, then put the totals in the calculator: {call-out calculator}"
`),

  // Facebook: groups (only where allowed) and the Page.
  "fb-callout-cost": D(`
Only in groups that allow links, and only when someone is talking about call-outs.

"We worked this out for a few buildings: a 12-hour call-out covered with overtime at $18/hr costs about $108 more than straight time. Four a month is over $400. There's a free calculator if you want to run your own numbers, no signup: {call-out calculator}"
`),
  "fb-poll-longest": D(`
Same poll as Post 3; bring the answers back for Post 14.

Schedulers: what takes the longest when you build next week's schedule?

A) Getting every shift covered
B) Call-outs and last-minute changes
C) Requests off and availability
D) Something else (tell us!)

Drop a letter below. We'll pull together tips for whatever comes up most.
`),
  "fb-template": D(`
Answer a "does anyone have a template?" question with it, as the Page.

"We made a free printable one: shift codes, a coverage check for each shift, and an hours column that flags overtime. PDF or Excel, no signup: {template link}. Happy to help if you get stuck setting it up."
`),
  "fb-first-week": D(`
Post 15 in plain words. Only where the admin said yes. Plain text, as the Page.

Schedulers, would it help if someone sat with you for 30 minutes and built next week's schedule with you? We're doing this free for a few facilities this month, mostly to learn what's hardest for you. Comment or message us if you're interested.
`),
  "fbp-pinned": D(`
Pin it. Links in the first comment.

Free for schedulers, no signup needed:

📄 Printable weekly CNA schedule (PDF + Excel): shift codes, a coverage check, and an hours column that flags overtime.

🧮 Call-out cost calculator: see what call-outs cost you a year in overtime, agency and your own time.

Links in the first comment. When you're ready to stop rebuilding the spreadsheet every week, WiserShifts is free for one scheduler and up to 15 staff.

First comment: Template: {template link} · Calculator: {call-out calculator} · Start free: {signup link}
`),
  "fbp-reel-callout": D(`
Same cut as the YouTube Short (see "Short: the 5 a.m. call-out").

Caption: 5:04 a.m. "Can't make it today." Covering a call-out shouldn't take an hour. 👇 How do you cover yours?
`),
  "fbp-question": D(`
Turn the best answers into a tip post.

Schedulers: what takes the longest when you build next week's schedule?

A) Getting every shift covered
B) Call-outs and last-minute changes
C) Requests off and availability
D) Something else (tell us!)

Drop a letter below. We'll share tips for whatever comes up most.
`),
  "fbp-before-after": D(`
Two screenshots side by side: a messy spreadsheet on top, the published week below.

Same week, two ways.

Top: the spreadsheet a lot of us know. Three tabs called FINAL, a call-out typed into the cell, nights that say "ask DON," and a text you still have to send.

Bottom: the same week in WiserShifts. Every shift shows who's on it, the one open shift is flagged before Friday gets here, and when you hit Publish your staff get their schedule.

If yours looks more like the top one, you're not doing it wrong. Spreadsheets just weren't built for this.

WiserShifts is free for one scheduler and up to 15 staff. Link in the comments.

First comment: Start free: {signup link}
`),
};

/** Two more newsletters, so both kinds of week have a ready draft. */
const NEW_ITEMS = [
  {
    seedKey: "nl-sched-callout",
    title: "Schedulers' email: cover a 5 a.m. call-out in 5 minutes",
    format: "newsletter",
    channel: "newsletter",
    audience: ["scheduler"],
    status: "idea",
    play: "newsletter",
    notes: D(`
Schedulers' week. Send Tuesday morning.

Subject: Cover a 5 a.m. call-out in 5 minutes
Preview text: Without calling everyone on the list.

Hi {First name},

One fix this week: the early-morning call-out.

Instead of texting people one at a time:
1. Keep a short list, by shift, of who can cover (and who's already close to 40 hours).
2. Send the open shift to that whole list at once.
3. The first qualified yes gets it. Tell everyone else it's covered.

In WiserShifts that's one step: the open shift goes to the people who are qualified and free, and they pick it up from their own link. [Screenshot or the 30-second video]

Want to try it on your real schedule? Start free and I'll build your first week with you: {signup link}

{Your name}
WiserShifts
`),
  },
  {
    seedKey: "nl-leaders-overtime",
    title: "Leaders' email: where last month's overtime really came from",
    format: "newsletter",
    channel: "newsletter",
    audience: ["director", "operator"],
    status: "idea",
    play: "newsletter",
    notes: D(`
Leaders' week. Send Tuesday morning.

Subject: Where last month's overtime really came from
Preview text: A 10-minute check with last month's payroll.

Hi {First name},

Most overtime isn't planned. It's a call-out covered by whoever said yes first, who then crosses 40 hours by Friday.

A quick check with last month's payroll: take your five biggest overtime earners. For each one, count how many of their overtime hours came from covering someone else's shift.

If it's most of them, overtime is a coverage problem, not a headcount problem. And coverage can be fixed on the schedule.

See what call-outs cost your building: {call-out calculator}
Or reply "snapshot" and I'll look at one week of your schedule for you, free.

{Your name}
WiserShifts
`),
  },
];

/** Scripts added to each play (after yours, skipping any with the same name). */
const SCRIPTS = {
  "linkedin-posts": [
    { label: "Post formula", body: D(`
Line 1: the number or the moment ("5:04 a.m." / "$36,500").
Lines 2–4: the math or the story, three short lines.
Line 5: one thing to do about it this week.
Last line: a question people can answer in a comment.
First comment: the calculator or template link (not in the post).
No hashtags in the middle; two or three at the end, at most.
`) },
    { label: "Poll formula", body: D(`
Question: one thing schedulers or leaders argue about ("How do you cover a call-out?").
Options: four real answers, one of them "Something else (comment)".
Follow-up post a week later: "Here's what [X] of you said", plus one tip for the top answer.
`) },
    { label: "Reply to a comment", body: "Thanks, {First name}! [Answer their point in one or two lines.] What does it look like at your building?" },
  ],
  newsletter: [
    { label: "Leaders' week layout", subject: "[The number or the cost, in their words]", body: D(`
Hi {First name},

One number this week.

[The number, worked out for a building their size, in three lines of math.]

[Why it happens, in two sentences.]

[What to do about it, in one sentence.]

Two ways to get yours:
- Try the calculator (2 minutes): {calculator link}
- Or reply "snapshot" and I'll work it out from one week of your schedule, free.

{Your name}
WiserShifts
`) },
    { label: "Schedulers' week layout", subject: "[The task, fixed fast: 'Cover a call-out in 5 minutes']", body: D(`
Hi {First name},

One fix this week: [the task].

[The steps, three at most, that work with or without software.]

In WiserShifts: [the same thing in one line, with a screenshot or short video].

Want to try it on your real schedule? Start free and I'll build your first week with you: {signup link}

{Your name}
WiserShifts
`) },
    { label: "Reply to someone who clicked or replied", body: "Hi {First name}, saw you checked out [the calculator / last week's email]. Want me to work out [the number] for {Building} from one week of your schedule? Free, one page, no call needed." },
  ],
  "youtube-howto": [
    { label: "Video script template", body: D(`
Title: the way a scheduler would search it ("How to cover a call-out in 5 minutes").
Hook (0–10s): the moment ("It's 5 a.m. and someone just called out…") and the promise ("here's how in five minutes").
Steps: 3 to 6, each shown on screen, one sentence each.
The no-software way: one line, so it helps even people who never sign up.
Close: "The [template / calculator] is in the description. Start free at wisershifts.com."
Description: the matching template or calculator link first, then Start free.
`) },
    { label: "30-second Short template", body: D(`
0–3s: text on screen with the moment ("5:04 a.m.").
3–12s: the old way ("Before").
12–25s: the new way, one tap ("After").
25–30s: the line people remember, then "WiserShifts. Free to start."
Post it as a YouTube Short and a Facebook Reel.
`) },
    { label: "Description template", body: "[One line: the problem this solves.]\n\nFree [template / calculator]: [link]\nStart free (1 scheduler, up to 15 staff): {signup link}\n\nChapters:\n0:00 [Hook]\n0:15 [Step 1]\n…" },
  ],
  "search-templates": [
    { label: "Blog post outline", body: D(`
For one search, e.g. "how to calculate hours per resident day".
1. The answer in the first two sentences (people skim).
2. The formula or the steps.
3. A worked example with real-looking numbers.
4. Common mistakes.
5. How to use it before the week, not after.
6. End with the matching calculator or template, then Start free.
Title: the search itself, plus "(with a worked example)" or "(free template)".
`) },
    { label: "Template page outline", body: D(`
Title: "Free printable [what it is] (PDF and Excel)".
What's in it: three bullets.
How to use it: five steps.
Download buttons: PDF and Excel, no signup.
End: "When you're ready to stop rebuilding it every week: start free, and we'll build your first week with you."
`) },
  ],
  "calculator-followup": [
    { label: "Same day", subject: "Your [hours per resident day / call-out cost] result", body: D(`
Hi {First name},

Here's your result from the calculator: [their result, in one line].

How it's worked out: [the math, in two lines].

If you want, reply with one week of your schedule and I'll check it against what was actually worked, free.

{Your name}, WiserShifts
`) },
    { label: "Day 3", subject: "What [the number] looks like every week", body: D(`
Hi {First name},

The number you worked out the other day is one WiserShifts shows every week for your building, before payroll does, so next week's schedule can change instead of last month's report.

[Screenshot of the weekly labor view.]

{Your name}
`) },
    { label: "Day 7", subject: "Every Monday for {Building}?", body: "Hi {First name},\n\nWant this every Monday for {Building}? Start free ({signup link}), or reply and I'll set it up with your scheduler.\n\n{Your name}" },
  ],
  "calls-front-desk": [
    { label: "Voicemail (scheduler)", body: "Hi, this is {Your name} from WiserShifts. I'm calling for whoever builds the CNA schedule. We help schedulers cover call-outs and build the week faster, and I'd like to set up your first week with you, free. My number is [your number]. Again, {Your name}, WiserShifts. Thanks!" },
    { label: "If they say \"we already have a system\"", body: "That makes sense, most buildings do. Out of curiosity, how do you cover a call-out at 5 a.m. with it? [Listen.] If that ever gets painful, the free setup is there. Who'd be the right person if I send a one-pager?" },
    { label: "If they say \"we use an agency\"", body: "Got it. We're not an agency. We help your own staff pick up open shifts first, so the agency is the backup instead of the plan. Would the scheduler want to see how many shifts that could keep in-house?" },
    { label: "If they say \"just send me something\"", body: "Happy to. What's the best email, and who should it go to? I'll send one page and the free template. Can I check back Thursday to see if it's worth 10 minutes?" },
  ],
  "calls-leadership": [
    { label: "Voicemail (DON or administrator)", body: "Hi {First name}, this is {Your name} from WiserShifts. I can work out {Building}'s hours per resident day and the overtime that's coming from one week of your schedule, free, on one page. My number is [your number], or just reply to my email. Thanks!" },
    { label: "If they say \"no budget\"", body: "Understood. The setup and the snapshot are free, and one scheduler with up to 15 staff stays free. If the snapshot shows overtime you can cut, that's the budget conversation. Want me to send it?" },
  ],
  "email-hprd": [
    { label: "When they reply \"snapshot\"", subject: "Re: Hours per resident day at {Building}", body: "Thanks, {First name}! Send me one week of the schedule (a photo, PDF or spreadsheet is fine) and your average census for that week. I'll send back one page within two working days: hours per resident day by day, and any overtime that's coming." },
    { label: "When they ask what it costs", subject: "Re: Hours per resident day at {Building}", body: "Good question. The snapshot and the setup are free. WiserShifts is free for one scheduler and up to 15 staff, and paid plans start when you need more. Want the snapshot first so you can see if it's worth it?" },
  ],
  "email-operator": [
    { label: "When they reply", subject: "Re: [their subject]", body: "Thanks, {First name}! Which building would make the best pilot? I'll set it up with that building's scheduler this week, free for a month, and send you its overtime and coverage every Monday. Does a 15-minute call on [day] work to pick the building?" },
  ],
};

// Content gets copied straight into posts, so it carries the real links. Scripts keep {First name},
// {Building} and {Your name} (filled on This week); newsletters use Klaviyo's own first-name tag.
const LINKS = {
  "{calculator link}": "https://wisershifts.com/calculators/hours-per-resident-day-calculator",
  "{call-out calculator}": "https://wisershifts.com/calculators/call-out-cost-calculator",
  "{template link}": "https://wisershifts.com/templates/weekly-cna-schedule-template.pdf",
  "{signup link}": "https://wisershifts.com/signup",
};
const withLinks = (t) => Object.entries(LINKS).reduce((out, [k, v]) => out.split(k).join(v), t);
const forKlaviyo = (t) => withLinks(t).split("Hi {First name},").join('Hi {{ first_name|default:"there" }},').split("{Your name}").join("[your name]");
for (const k of Object.keys(DRAFTS)) DRAFTS[k] = k.startsWith("nl-") ? forKlaviyo(DRAFTS[k]) : withLinks(DRAFTS[k]);
for (const item of NEW_ITEMS) item.notes = item.format === "newsletter" ? forKlaviyo(item.notes) : withLinks(item.notes);
for (const k of Object.keys(SCRIPTS)) for (const sc of SCRIPTS[k]) sc.body = withLinks(sc.body);

module.exports = { DRAFTS, NEW_ITEMS, SCRIPTS };
