/**
 * Starting playbook for HQ, from "WiserShifts Hybrid Playbook: Plays by
 * Channel" plus the content plays for schedulers. Loaded once, when HQ's
 * playbook is empty; after that everything is edited in HQ.
 */

const NOT_AGENCY = "We're software for your own team, not an agency.";

// Version 4: one Klaviyo content email a week, by buyer (replaces "The Labor Math" newsletter, which we never sent).
const NEWSLETTER_V4 = {
  title: "Klaviyo content email (one a week, by buyer)",
  fields: {
    audience: ["scheduler", "director", "operator"],
    who: "Everyone on the Klaviyo list: leaders and schedulers who opted in or that we've emailed before.",
    goal: "Real clicks and replies. Anyone who clicks or replies gets a personal follow-up (it shows up in To do now).",
    when: "One email a week, Tuesday morning. Alternate: leaders one week, schedulers the next. Once role is tagged in Klaviyo, send each to its own segment.",
    steps: [
      "Leaders' week: one cost, worked out for a building their size (\"What could 12 minutes per shift be costing your facility?\"). Our best emails so far are this kind. Ask: reply 'snapshot', or try the calculator.",
      "Schedulers' week: one task, fixed fast (cover a call-out, build next week, a fair weekend rotation). Show it with a screenshot or a short video. Ask: start free, and I'll build your first week with you.",
      "One idea per email. No feature lists, no product updates, no \"simplify your scheduling\".",
      "The subject line names the problem or the number, in their words.",
      "Reuse the week's LinkedIn post or video: same idea, written for one buyer.",
      "The Monday labor email is a product feature. Talk about it as something WiserShifts does for their building, never as something we send to the list.",
    ],
    volume: "1 email a week.",
    weeklyTarget: 1,
    targetUnit: "emails",
    countsFrom: "content",
    measure: "Real clicks (Klaviyo email page in HQ), replies, calculator visits, unsubscribes. Compare leader weeks with scheduler weeks.",
  },
};
const NL1_TITLE = "Leaders' email: what 0.1 hours per resident day costs a 50-bed building";

/** The Facebook groups play before version 8 (counted from content posts). */
const FB_GROUPS_V7 = {
  title: "Scheduler Facebook groups",
  who: "Schedulers and staffing coordinators in CNA, nursing and senior living groups.",
  goal: "Be the helpful person in the group; schedulers try the templates and start free.",
  steps: ["Answer scheduling questions with real help, no pitch.", "Share a template or video when it answers the question.", "Mention WiserShifts only when someone asks what you use."],
  volume: "3 helpful posts or answers a week.",
  weeklyTarget: 3,
  targetUnit: "posts",
  countsFrom: "content",
  measure: "Clicks to templates, signups that say Facebook.",
};
/** Version 8: groups are tracked one by one on HQ's Facebook page, as the Page. */
const FB_GROUPS_PLAY = {
  seedKey: "facebook-groups",
  title: "Facebook groups (as the Page)",
  channel: "facebook",
  audience: ["scheduler"],
  who: "Schedulers, staffing coordinators and nurse leaders in the groups listed on HQ's Facebook page.",
  goal: "Be the helpful Page in every group. Admins say yes to the offer; everyone who comments gets a message and a setup call.",
  steps: [
    "Find groups and add them on HQ's Facebook page: size, rules, and whether Pages can join.",
    "Join as the WiserShifts Page, never a personal profile.",
    "Message the admin before any offer. Follow up once after 5 days, then let it go.",
    "Once the admin says yes (or the group allows it), post the offer as plain text.",
    "Every week: answer real questions with no pitch. Share a template when it answers the question.",
    "Everyone who comments or reacts goes on People to message. Message them the same day.",
  ],
  scripts: [
    { label: "Message to the admin", body: "Hi! We're WiserShifts, a scheduling tool for care facilities. Would it be okay to post a free offer to help a few schedulers set up their schedule? No sales pitch, and we're happy to follow whatever rules you have." },
    { label: "Admin follow-up", body: "Hi again! Just checking whether a free offer to help a few schedulers would be okay in the group. Totally fine if not; we'll keep answering questions either way." },
    { label: "The offer (plain text, as the Page)", body: "Schedulers, would it help if someone sat with you for 30 minutes and built next week's schedule with you? We're doing this free for a few facilities this month, mostly to learn what's hardest for you. Comment or message us if you're interested." },
    { label: "Message to a commenter", body: "Hi [name], thanks for commenting! What days and times work for a 30-minute call this week? Send over your current schedule whenever (a photo is fine) and we'll have it ready to go." },
    { label: "Commenter follow-up", body: "Hi [name], just following up on the free schedule setup. Still happy to build next week's schedule with you if it would help. Any time this week?" },
  ],
  volume: "5 group touches a week (joins, admin messages, the offer, answers), plus everyone who comments.",
  weeklyTarget: 5,
  targetUnit: "group touches",
  countsFrom: "activities",
  measure: "Groups joined and approved, people messaged and replied, setup calls booked, signups that say Facebook.",
};

/** The Facebook channel: your WiserShifts Page plus the groups (version 7). */
const FB_CHANNEL = {
  oldName: "Facebook groups",
  oldWhy: "Where schedulers and CNAs talk shop. Be helpful; share a template or video when it answers the question.",
  name: "Facebook: your Page and groups",
  why: "Your WiserShifts Page is home base for posts and Reels; groups are where schedulers and CNAs talk shop. Be helpful, share a template or video when it answers the question, and bring people back to the Page.",
};
const FB_PAGE_IDEAS = [
  ["fbp-pinned", "Pinned Page post: the free template and calculator", "Pin it; links in the first comment."],
  ["fbp-reel-callout", "Reel: the 5 a.m. call-out", "Same cut as the YouTube Short."],
  ["fbp-question", "Page question: what takes the longest when you build the schedule?", "Turn the best answers into a tip post."],
  ["fbp-before-after", "Before and after: a messy spreadsheet vs. a published week", "Two screenshots side by side."],
];

/**
 * Version 9: hours per resident day is a nursing home number, so the play
 * gets an overtime version for assisted and senior living, and a
 * one-building pilot for companies that run several buildings.
 */
const EMAIL_HPRD_V9 = [
  {
    label: "Assisted / senior living: Email 1 (overtime)",
    subject: "Overtime at {Building} last month",
    body: "Hi {First name},\n\nQuick question: how much overtime did {Building} pay last month, and how much of it came from call-outs?\n\nMost EDs I talk to only see it when payroll closes. Send me one week of your schedule and I'll send back one page, free: where the overtime is coming from and which shifts are most likely to go uncovered next.\n\nOr see what call-outs cost you in 2 minutes: {call-out calculator}\n\n{Your name}, WiserShifts (scheduling software for your own team, not an agency)",
  },
  {
    label: "Assisted / senior living: Email 2 (day 4)",
    subject: "Re: Overtime at {Building} last month",
    body: "One call-out covered with overtime on a 12-hour shift at $18/hr is about $108 extra. Want me to look at yours?",
  },
  {
    label: "Company with several buildings: one-building pilot",
    subject: "One building, one month",
    body: "Hi {First name},\n\nWould you be open to trying a different way of scheduling in just one of your buildings for a month? It's free. We set it up with that building's scheduler, and you'd see its overtime and coverage every week. Then you decide.\n\nWorth a 15-minute call?\n\n{Your name}, WiserShifts",
  },
];

const PLAYS = [
  {
    seedKey: "calls-front-desk",
    title: "Front desk to scheduler, free setup",
    channel: "calls",
    audience: ["scheduler"],
    who: "The scheduler or staffing coordinator.",
    goal: "A free setup of next week's schedule, booked on the call.",
    when: "Monday to Thursday, 9 to 11 a.m. (their time).",
    steps: [
      "Call the main line.",
      "Front desk: ask who handles staff scheduling. Get the name and their direct line or email.",
      "Also ask who the director of nursing and administrator are. Add both as people on the facility.",
      "Offer the scheduler a free setup of next week's schedule.",
      "Book a 15-minute setup call before you hang up.",
      "At setup, ask to add the administrator to the Monday labor email. Turn on the trial so it goes out.",
    ],
    scripts: [
      { label: "Front desk", body: "Hi, who handles staff scheduling there? I'd like to send them something that saves time on the weekly schedule." },
      { label: "Leadership names", body: "And who's your director of nursing and administrator?" },
      { label: "Scheduler", body: "I'll build next week's schedule for you in WiserShifts, free. You send me who works and what you need per shift, and it goes to your team's phones. Want me to set it up for next week?" },
      { label: "At setup", body: "Can I add your administrator to the Monday labor email?" },
    ],
    volume: "60 calls a week.",
    weeklyTarget: 60,
    targetUnit: "calls",
    countsFrom: "activities",
    measure: "Calls, schedulers reached, setups booked, weeks sent.",
  },
  {
    seedKey: "calls-leadership",
    title: "The leadership follow-up call",
    channel: "calls",
    audience: ["director"],
    who: "The DON or administrator, at a building where you already know a name.",
    goal: "A free labor snapshot, or the Monday email turned on.",
    when: "After a setup (the scheduler is using WiserShifts), after a signal (they clicked an email or used a calculator), or after their first Monday email.",
    steps: [
      "Ask for the DON or administrator by name.",
      "With a setup: offer last week's numbers on one page.",
      "Without one: offer to work out their hours per resident day from the schedule, free.",
      "If yes: get their email, send the printed summary within two days, then call again to walk through it in 10 minutes.",
      `Always say once: "${NOT_AGENCY}"`,
    ],
    scripts: [
      { label: "With a setup", body: "Your scheduler built next week in WiserShifts. It also shows you hours per resident day against budget and who's heading into overtime before payroll. Can I send you last week's numbers on one page?" },
      { label: "Without a setup", body: "Do you know your hours per resident day last week? I'll work it out from your schedule and send it on one page, free." },
    ],
    volume: "15 to 20 calls a week.",
    weeklyTarget: 15,
    targetUnit: "calls",
    countsFrom: "activities",
    measure: "Reached, snapshots sent, trials, upgrades.",
  },
  {
    seedKey: "email-hprd",
    title: "\"Your hours per resident day\" cold email",
    channel: "email",
    audience: ["director"],
    who: "DONs and administrators at buildings you've called, or in tiers 1 and 2.",
    goal: "A reply asking for the free labor snapshot.",
    when: "Three emails, on days 1, 4 and 9. Send from your own inbox.",
    steps: ["Links to the hours per resident day calculator and /for/directors.", "Lead with their number, not our features."],
    scripts: [
      { label: "Email 1", subject: "Hours per resident day at {Building}", body: "Hi {First name},\n\nQuick question: do you know {Building}'s hours per resident day last week, and how it compared to budget?\n\nMost administrators I talk to find out a month later, from payroll. I'll work it out from your schedule and send it back on one page, free, with any overtime that's coming.\n\nOr try it yourself in two minutes: {calculator link}\n\n{Your name}, WiserShifts (scheduling and labor software for your own team, not an agency)" },
      { label: "Email 2 (day 4)", subject: "Re: Hours per resident day at {Building}", body: "At 50 residents, every 0.1 hours per resident day is about $36,500 a year in wages. Want me to send you yours?" },
      { label: "Email 3 (day 9)", subject: "Re: Hours per resident day at {Building}", body: "Last note from me. If someone else owns the schedule there, who should I send this to?" },
      ...EMAIL_HPRD_V9,
    ],
    volume: "30 to 40 new a week.",
    followUps: [4, 9],
    weeklyTarget: 35,
    targetUnit: "emails",
    countsFrom: "activities",
    measure: "Opens, replies, calculator visits, snapshots sent, trials.",
  },
  {
    seedKey: "email-operator",
    title: "One-building pilot cold email",
    channel: "email",
    audience: ["operator"],
    who: "Management companies or owners with three or more buildings.",
    goal: "A demo with a regional director.",
    when: "Days 1, 5 and 12.",
    steps: ["Links to /for/operators and the demo link."],
    scripts: [
      { label: "Email 1", subject: "Monday labor numbers for {Operator}'s buildings", body: "Hi {First name},\n\nDo you get each building's hours per resident day, overtime and call-outs every Monday, or at month end?\n\nWiserShifts emails each administrator and you those numbers every Monday, worked out the same way in every building. Your schedulers build and send the schedule in it too.\n\nWould you try it in one building for a month? Here's what the email looks like: {/for/operators link}" },
      { label: "Email 2 (day 5)", body: "We set up {nearby building} last month; happy to show you what their Monday email looks like." },
      { label: "Email 3 (day 12)", body: "Who runs scheduling at {one of their buildings}? I'll start there." },
    ],
    volume: "5 to 10 operators a week.",
    followUps: [5, 12],
    weeklyTarget: 8,
    targetUnit: "emails",
    countsFrom: "activities",
    measure: "Replies, demos, pilot buildings, buildings added.",
  },
  {
    seedKey: "linkedin-posts",
    title: "One labor number a week (founder posts)",
    channel: "linkedin",
    audience: ["director", "operator"],
    who: "DONs, administrators and regional directors.",
    goal: "Profile visits and calculator clicks from senior living leaders.",
    when: "Tuesday or Wednesday morning, from your personal profile.",
    steps: [
      "One number, the math in three lines, one thing to do about it.",
      "The calculator link goes in the first comment, not the post.",
      "Reply to every comment the same day.",
      "Content only: no connection requests or cold messages (free accounts).",
      "Plan posts in the Content plan and link them to this play.",
    ],
    volume: "1 post a week, each founder.",
    weeklyTarget: 2,
    targetUnit: "posts",
    countsFrom: "content",
    measure: "Profile views from the right titles, calculator visits from LinkedIn, inbound messages.",
  },
  {
    seedKey: "newsletter",
    title: NEWSLETTER_V4.title,
    channel: "newsletter",
    ...NEWSLETTER_V4.fields,
  },
  {
    seedKey: "calculator-followup",
    title: "Calculator follow-up (three emails)",
    channel: "newsletter",
    audience: ["scheduler", "director"],
    who: "Anyone who leaves their email on a calculator.",
    goal: "Turn a visit into a snapshot or a trial.",
    when: "Automatic in Klaviyo: same day, day 3, day 7 (trigger: the \"Used Calculator\" event).",
    steps: [
      "Same day: their result restated in one line, plus the math.",
      "Day 3: what WiserShifts shows every week for the same number, with a screenshot.",
      "Day 7: \"Want this every Monday for {Building}? Start free, or reply and I'll set it up with your scheduler.\"",
    ],
    volume: "Always on.",
    weeklyTarget: null,
    targetUnit: "calculator emails",
    countsFrom: "leads",
    measure: "Calculator emails, sequence replies, trials from the sequence.",
  },
  {
    seedKey: "youtube-howto",
    title: "Scheduler how-to videos",
    channel: "youtube",
    audience: ["scheduler"],
    who: "Schedulers and staffing coordinators (they search YouTube and Google, not LinkedIn).",
    goal: "Schedulers find us while solving a problem, then start free.",
    when: "One video a week. Short versions for Facebook and Shorts.",
    steps: [
      "One problem per video, solved on screen in under 5 minutes (covering a call-out, building next week, weekend rotation).",
      "Title it the way a scheduler would search it.",
      "Link to the matching template or calculator in the description, then Start free.",
    ],
    volume: "1 video a week.",
    weeklyTarget: 1,
    targetUnit: "videos",
    countsFrom: "content",
    measure: "Views, watch time, clicks to the site, signups from YouTube.",
  },
  {
    seedKey: "search-templates",
    title: "Free templates and how-to posts (search)",
    channel: "blog",
    audience: ["scheduler", "director"],
    who: "Anyone searching for a schedule template or how to work out a labor number.",
    goal: "Show up on Google for what schedulers and DONs search; turn visits into calculator emails and signups.",
    steps: [
      "One blog post or printable template every two weeks, written for one search (\"CNA schedule template\", \"how to calculate hours per resident day\").",
      "Every post ends with the matching calculator and Start free.",
      "Check Web & search to see which searches find us, and write more of those.",
    ],
    volume: "1 piece every two weeks.",
    weeklyTarget: 0.5,
    targetUnit: "posts",
    countsFrom: "content",
    measure: "Google clicks and positions, calculator emails, signups from search.",
  },
  FB_GROUPS_PLAY,
  {
    seedKey: "facebook-page",
    title: "WiserShifts Facebook Page",
    channel: "facebook",
    audience: ["scheduler", "director"],
    who: "Schedulers, staffing coordinators and DONs who follow the Page or find it from a group, a share or a search.",
    goal: "A Page people trust: useful posts that bring schedulers to the free templates and calculators, then to a free account.",
    steps: [
      "Set it up once: logo, a cover that says what WiserShifts does in one line, the button set to Sign up, and a pinned post with the free templates and calculator.",
      "Invite friends and colleagues who work in care to like it; the first 50 to 100 followers make every later post look credible.",
      "Post 3 times a week: a template or tip, a short video or Reel, and a question schedulers want to answer.",
      "Put the useful part in the post itself and the link in the first comment.",
      "Join scheduler and CNA groups as the Page where groups allow it; the groups play is still where most people first see you.",
      "Reply to every comment and message the same day, and ask commenters what they use today.",
      "When a post does well, share it from your own profile and into groups that allow it. Boost only a post that already worked, with a small budget aimed at schedulers and DONs.",
    ],
    scripts: [
      { label: "Pinned post", body: "Free for schedulers: the printable weekly schedule template and the call-out cost calculator, no signup needed. If you want the week built for you and sent to your staff by text, WiserShifts is free to start. Links in the comments." },
      { label: "Question post", body: "Schedulers: what takes the longest when you build next week's schedule? Coverage, call-outs, requests off, or something else? I'll share what works from the answers." },
      { label: "Invite your friends", body: "I started a Page for WiserShifts, the scheduling tool I'm building for care facilities. If you work in one or know a scheduler, a like or a share would really help. I'll post free templates and tips there." },
    ],
    volume: "3 Page posts a week.",
    weeklyTarget: 3,
    targetUnit: "posts",
    countsFrom: "content",
    measure: "Followers, comments and shares; clicks to the templates and calculators; signups that say Facebook.",
  },
];

// LinkedIn is content only: founder posts on free accounts, no connection requests or cold messages.
const LINKEDIN_WHY =
  "Content only, from the founders' free accounts: posts make your name familiar before the email or call lands. No connection requests or cold messages. Leaders are on it; schedulers mostly aren't. Three posts a week from the founders.";

const META = {
  tierRules: [
    { tier: "Tier 1 (Close First)", plays: "Everything: front-desk call, leadership email the same week, Monday email turned on at setup, operator email if they belong to a group." },
    { tier: "Tier 2", plays: "Front-desk call and one leadership email." },
    { tier: "Tiers 3 and 4", plays: "Front-desk call only, plus the weekly Klaviyo content email if they're on the list." },
  ],
  week: [
    { day: "Monday", a: "15 front-desk calls", b: "Check who got their first Monday labor email; leadership follow-up calls to them" },
    { day: "Tuesday", a: "15 front-desk calls", b: "LinkedIn post; the week's Klaviyo content email (leaders one week, schedulers the next)" },
    { day: "Wednesday", a: "15 front-desk calls; setup calls", b: "30 to 40 leadership emails to buildings called this week" },
    { day: "Thursday", a: "15 front-desk calls; setup calls; record a scheduler video", b: "Operator emails (5 to 10); reply to LinkedIn comments" },
    { day: "Friday", a: "Snapshots and printed summaries out", b: "Follow-ups to replies and calculator emails; Facebook groups; check the scoreboard" },
  ],
  founders: ["Founder A", "Founder B"],
  note: "The weekly targets are starting guesses. Reset them after four weeks of real numbers.",
};

const CONTENT = [
  ["li-tenth", "What 0.1 hours per resident day costs a 50-bed building ($36,500 a year in wages)", "linkedin_post", "linkedin", ["director", "operator"], "linkedin-posts"],
  ["li-ot-late", "Why overtime shows up on payroll two weeks too late, and the day of the week it usually starts", "linkedin_post", "linkedin", ["director", "operator"], "linkedin-posts"],
  ["li-staffed-needed", "Hours staffed vs hours needed: looking under budget while short-staffed", "linkedin_post", "linkedin", ["director"], "linkedin-posts"],
  ["li-fte", "How many full-time CNAs a 3-shift building needs once you allow 10% for time off", "linkedin_post", "linkedin", ["director", "operator"], "linkedin-posts"],
  ["li-quit-signs", "Three signs someone is about to quit: call-outs, overtime streaks, hours dropping off", "linkedin_post", "linkedin", ["director"], "linkedin-posts"],
  ["li-sunday", "What a scheduler's Sunday looks like before and after", "linkedin_post", "linkedin", ["director", "scheduler"], "linkedin-posts"],
  ["li-certs", "Certifications that expire quietly, and what a 30-day warning saves", "linkedin_post", "linkedin", ["director"], "linkedin-posts"],
  ["nl-1", NL1_TITLE, "newsletter", "newsletter", ["director", "operator"], "newsletter"],
  ["yt-callout", "How to cover a call-out in 5 minutes (without calling everyone)", "video", "youtube", ["scheduler"], "youtube-howto"],
  ["yt-next-week", "Build next week's CNA schedule in 10 minutes", "video", "youtube", ["scheduler"], "youtube-howto"],
  ["yt-weekend", "A fair weekend rotation your staff won't fight over", "video", "youtube", ["scheduler"], "youtube-howto"],
  ["tpl-weekly", "Printable weekly CNA schedule template", "template", "website", ["scheduler"], "search-templates"],
  ["blog-hprd", "How to calculate hours per resident day (with a worked example)", "blog_post", "blog", ["director"], "search-templates"],
  ["fb-callout-cost", "Share the call-out cost calculator in scheduler groups", "facebook_post", "facebook", ["scheduler"], "facebook-groups"],
];

// ── Version 2: the written playbook (buyers, channels), the LinkedIn plan, more video and Facebook ideas ──

const META_V2 = {
  overview:
    "WiserShifts sells two ways at once. Bottom-up: the scheduler starts free and builds the schedule in WiserShifts. Top-down: the DON, administrator or regional director sees their labor numbers (hours per resident day, overtime, call-outs) in the Monday labor email. Every play aims at one of three free offers: a free setup of next week's schedule, a free one-page labor snapshot, or the free calculators. A free account with the Monday labor email turned on is what converts to paid.",
  connect:
    "The channels feed each other. Calls collect leaders' names for email. Emails, posts and videos send people to the calculators. Calculator emails go to the newsletter and the follow-up sequence. Anyone who replies anywhere gets a call. We're software for their own team, never a staffing agency: say it once in every conversation.",
  buyers: [
    {
      key: "scheduler",
      name: "Schedulers",
      who: "The scheduler or staffing coordinator (sometimes the DON in a small building). Builds the schedule, covers call-outs, chases replies.",
      cares: "Sunday nights spent on the schedule, 5 a.m. call-outs, \"I didn't know I was on\", time off on sticky notes.",
      where: "Google and YouTube when stuck, Facebook groups, the phone at the front desk. Rarely LinkedIn or cold email.",
      offer: "Free account, and \"I'll build your first week with you\".",
      how: "Content they find while solving a problem (videos, templates, search), front-desk calls, a few LinkedIn posts.",
    },
    {
      key: "director",
      name: "DONs, EDs and administrators",
      who: "Director of nursing, executive director, administrator. Owns the labor budget and signs off.",
      cares: "Hours per resident day against budget, overtime before payroll, call-outs by shift, certifications, who's about to quit.",
      where: "Email and LinkedIn. They answer the phone after they've heard of you.",
      offer: "A free one-page labor snapshot, then the Monday labor email.",
      how: "Leadership email, the follow-up call, LinkedIn posts, the newsletter.",
    },
    {
      key: "operator",
      name: "Regional operators and owners",
      who: "Regional director of operations, VP, COO or owner of a group of buildings.",
      cares: "The same numbers in every building, every Monday; labor cost across the group.",
      where: "Email and LinkedIn.",
      offer: "A one-building pilot for a month.",
      how: "Operator email, LinkedIn, the newsletter, and proof from a building already set up in their region.",
    },
  ],
  channels: [
    { key: "calls", name: "Calls", why: "Reach the people who never answer email: the scheduler first, then the DON or administrator once there's something to show." },
    { key: "email", name: "Cold outreach email", why: "One-to-one emails from your own inbox (Gmail or Outlook), not Klaviyo, to DONs, administrators and regional directors you haven't called yet. Lead with their number, not our features. Log each one in HQ." },
    { key: "linkedin", name: "LinkedIn", why: LINKEDIN_WHY },
    { key: "newsletter", name: "Klaviyo: newsletter and sequences", why: "Content, not cold outreach: the newsletter and the calculator follow-up, sent through Klaviyo. Useful and short, never a product update. Klaviyo shows who really clicks; anyone who does gets a personal follow-up." },
    { key: "youtube", name: "YouTube", why: "Schedulers search for how to do the job. One short how-to a week, each solving one problem on screen." },
    { key: "blog", name: "Blog and search", why: "Templates and how-to posts that show up on Google for what schedulers and DONs search." },
    { key: "facebook", name: FB_CHANNEL.name, why: FB_CHANNEL.why },
  ],
};

const LINKEDIN_POSTS = require("./linkedinPosts.json");
// Who each post speaks to most (posts 3, 8, 10, 13, 14 reach leaders too).
const POST_AUDIENCE = (n) => ([3, 8, 10, 13, 14].includes(n) ? ["scheduler", "director"] : ["scheduler"]);

const CONTENT_V2 = [
  ...LINKEDIN_POSTS.map((p) => ({
    seedKey: `li-plan-${p.num}`,
    title: `Post ${p.num}: ${p.title}`,
    format: "linkedin_post",
    channel: "linkedin",
    audience: POST_AUDIENCE(p.num),
    status: "ready",
    play: "linkedin-posts",
    notes: `When: ${p.when}\n\n${p.body}${p.visual ? `\n\nVisual: ${p.visual}` : ""}`,
  })),
  ...[
    ["yt-staff-link", "How your staff see their schedule without an app (staff link walkthrough)", "Turns Post 4 into a 2-minute screen recording."],
    ["yt-publish-unit", "Send one unit's schedule while the rest is still in progress", "From Post 5. Show the Publish sheet with one area picked."],
    ["yt-swaps", "Shift swaps without the group chat", "From Post 11. Holiday timing."],
    ["yt-time-off", "Time-off requests in one place (no sticky notes)", "From Post 12."],
    ["yt-first-week", "Your first week in WiserShifts, start to send, in 10 minutes", "The free-setup offer on video (Post 15)."],
  ].map(([seedKey, title, notes]) => ({ seedKey, title, format: "video", channel: "youtube", audience: ["scheduler"], status: "idea", play: "youtube-howto", notes })),
  ...[
    ["short-5am", "Short: the 5 a.m. call-out (30 seconds)", "Cut from the call-out video for YouTube Shorts and Facebook."],
    ["short-sunday", "Short: the Sunday schedule, before and after", "From Post 1."],
  ].map(([seedKey, title, notes]) => ({ seedKey, title, format: "short_video", channel: "youtube", audience: ["scheduler"], status: "idea", play: "youtube-howto", notes })),
  ...[
    ["fb-poll-longest", "Ask the group: what takes the longest when you build the schedule?", "Same poll as Post 3; bring the answers back to Post 14."],
    ["fb-template", "Share the printable weekly schedule template", "Answer a \"does anyone have a template\" question with it."],
    ["fb-first-week", "Offer: I'll build your first week with you", "Post 15, in plain words, where the group allows offers."],
  ].map(([seedKey, title, notes]) => ({ seedKey, title, format: "facebook_post", channel: "facebook", audience: ["scheduler"], status: "idea", play: "facebook-groups", notes })),
  ...FB_PAGE_IDEAS.map(([seedKey, title, notes]) => ({ seedKey, title, format: "facebook_post", channel: "facebook", audience: ["scheduler", "director"], status: "idea", play: "facebook-page", notes })),
  {
    seedKey: "tpl-callout-log",
    title: "Call-out log template (printable)",
    format: "template",
    channel: "website",
    audience: ["scheduler", "director"],
    status: "idea",
    play: "search-templates",
    notes: "Pairs with the call-out cost calculator.",
  },
];

// Version 3: Klaviyo is the content channel; emails from your own inbox are cold outreach.
const V2_CHANNEL_TEXT = {
  email: "Reach DONs, administrators and regional directors you haven't called yet. Lead with their number, not our features. Send from your own inbox.",
  newsletter: "Stay in front of leaders between calls. Useful and short, never a product update.",
};
const V3_CHANNELS = Object.fromEntries(META_V2.channels.filter((c) => ["email", "newsletter"].includes(c.key)).map((c) => [c.key, c]));

module.exports = { PLAYS, META, CONTENT, META_V2, CONTENT_V2, V2_CHANNEL_TEXT, V3_CHANNELS };

// ── Version 4: messaging by buyer, and no "Labor Math" newsletter ──
// What we say to each buyer. Every piece of content, email, call and post starts here.
const MESSAGING = {
  scheduler: {
    promise: "Next week's schedule done in minutes. Call-outs covered without calling everyone.",
    pains: "Sunday nights on the schedule, the 5 a.m. call-out, chasing replies, \"I didn't know I was on\", time off on sticky notes, swaps in the group chat.",
    proof: "Show the task being done, on screen, in minutes. A real schedule, not a slide.",
    angles: "One task fixed per piece: cover a call-out, build next week, a fair weekend rotation, swaps, time off. Before and after. Printable templates.",
    cta: "Start free, and I'll build your first week with you.",
    avoid: "Hours per resident day, budgets, ROI, \"workforce management\". That's not their job.",
  },
  director: {
    promise: "See what staffing is costing you before payroll does.",
    pains: "Overtime found two weeks late on payroll, hours per resident day against budget, call-outs by shift, certifications lapsing before survey, turnover, agency hours.",
    proof: "The math: one number, worked out for a building their size. The calculators. A one-page snapshot of their own building.",
    angles: "\"What is X really costing you?\" (minutes per shift, turnover, call-outs, overtime, the time clock). Three signs someone's about to quit. Hours staffed vs hours needed. Our best Klaviyo emails are this kind.",
    cta: "Reply 'snapshot' for your building's numbers on one page, or try the calculator.",
    avoid: "Feature lists, \"simplify your scheduling\", free-trial-first emails (our weakest).",
  },
  operator: {
    promise: "The same labor numbers from every building, every Monday, without asking for them.",
    pains: "Each building reports differently, labor cost found after the month closes, the one building that's quietly over budget, no time to chase administrators for numbers.",
    proof: "A building already set up in their region; the same Monday numbers side by side.",
    angles: "Comparing buildings. The cost of one building running 0.2 hours per resident day over. What a pilot looks like in week one.",
    cta: "Try it in one building for a month.",
    avoid: "Scheduler how-tos, anything that sounds like a staffing agency.",
  },
};

const V4 = {
  overview:
    "WiserShifts sells two ways at once. Bottom-up: the scheduler starts free because next week's schedule gets done in minutes and call-outs get covered fast. Top-down: the DON, administrator or regional director starts because they see what staffing is costing them (hours per resident day, overtime, call-outs) before payroll does. Inside the product, that shows up as the Monday labor email. Every play aims at one of three free offers: a free setup of next week's schedule, a free one-page labor snapshot, or the free calculators. A facility that builds and sends its schedule in WiserShifts every week is what converts to paid.",
  connect:
    "The channels feed each other. Calls collect leaders' names for email. Emails, posts and videos send people to the calculators. Calculator emails get the follow-up sequence and, if they ticked the box, the weekly Klaviyo content email. Anyone who replies or really clicks gets a personal follow-up. Each buyer hears their own message (see the buyers above). We're software for their own team, never a staffing agency: say it once in every conversation.",
  how: {
    director: "Cold email from your own inbox, the follow-up call, LinkedIn posts, the leaders' Klaviyo email.",
    operator: "Cold email from your own inbox, LinkedIn, the leaders' Klaviyo email, and proof from a building already set up in their region.",
  },
  newsletterChannel: {
    name: "Klaviyo: content emails and sequences",
    why: "Content, not cold outreach. One email a week, alternating leaders (what it's costing you) and schedulers (fix it fast), plus the calculator follow-up. Never a product update. Klaviyo shows who really clicks; anyone who does gets a personal follow-up.",
  },
};

// The text versions 1 to 3 seeded, so version 4 only changes what nobody has edited.
const PRE_V4 = {
  newsletterTitle: "\"The Labor Math\" newsletter",
  nl1Title: "The Labor Math #1: the cost of 0.1 hours per resident day",
  tuesday: "LinkedIn post; newsletter (every other week)",
  tiers34: "Front-desk call only, plus the newsletter if you have an email.",
};

module.exports.MESSAGING = MESSAGING;
module.exports.V4 = V4;
module.exports.PRE_V4 = PRE_V4;
// Version 5: what converts is weekly use, not one feature.
module.exports.V5_OVERVIEW = { from: "A free account with the Monday labor email turned on is what converts to paid.", to: "A facility that builds and sends its schedule in WiserShifts every week is what converts to paid." };
module.exports.NEWSLETTER_V4 = NEWSLETTER_V4;
module.exports.NL1_TITLE = NL1_TITLE;
// Version 6: LinkedIn is content only (free accounts). What the earlier text said, and what it says now.
module.exports.V6_LINKEDIN = {
  oldWhy: "Make your name familiar before the email or call lands. Leaders are on it; schedulers mostly aren't. Three posts a week from the founders.",
  why: LINKEDIN_WHY,
  oldThursday: "Operator emails (5 to 10); LinkedIn connections and messages",
  thursday: "Operator emails (5 to 10); reply to LinkedIn comments",
  oldPostSteps: ["One number, the math in three lines, one thing to do about it.", "The calculator link goes in the first comment, not the post.", "Plan posts in the Content plan and link them to this play."],
  postSteps: [
    "One number, the math in three lines, one thing to do about it.",
    "The calculator link goes in the first comment, not the post.",
    "Reply to every comment the same day.",
    "Content only: no connection requests or cold messages (free accounts).",
    "Plan posts in the Content plan and link them to this play.",
  ],
  // Phrases taken out wherever they appear.
  replace: [
    ["LinkedIn connection with the DON or administrator, ", ""],
    ["Calls collect leaders' names for email and LinkedIn.", "Calls collect leaders' names for email."],
    ["LinkedIn posts and messages", "LinkedIn posts"],
  ],
};

module.exports.FB_CHANNEL = FB_CHANNEL;
module.exports.FB_PAGE_IDEAS = FB_PAGE_IDEAS;
module.exports.FB_GROUPS_V7 = FB_GROUPS_V7;
module.exports.FB_GROUPS_PLAY = FB_GROUPS_PLAY;
module.exports.EMAIL_HPRD_V9 = EMAIL_HPRD_V9;
