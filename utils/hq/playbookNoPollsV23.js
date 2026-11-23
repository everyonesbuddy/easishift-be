/**
 * Playbook version 23: no polls. Polls need an audience to answer them;
 * with a small one they sit at three votes and look empty. The three poll
 * posts (LinkedIn Posts 3, 9 and the results Post 14) and the two Facebook
 * questions become how-to posts that stand on their own, and the "Poll
 * formula" becomes a "Tip formula".
 */
const D = (s) => s.replace(/^\n/, "").replace(/\n\s+$/, "");

const CHECKS = D(`
Three checks before you publish next week's schedule:

1. Every shift has its minimum. Count CNAs on each shift against what the unit needs, nights and weekends included. The gaps hide on Saturday nights.

2. Nobody goes into overtime by accident. Add up each person's hours. Anyone at 36 or more before the week starts will be in overtime after the first call-out.

3. Time off is on it. Go through every request one more time: the text from Thursday, the sticky note, the one someone mentioned in the hallway.

Ten minutes before you publish saves a week of fixing it after.
`);

const COVER_ORDER = D(`
5:04 a.m. Someone can't make it. Who do you ask first?

The order matters more than the speed:

1. Part-timers under their hours. They usually want the shift, and it's straight time.
2. Full-timers who won't hit overtime with it. Check their week first.
3. People who asked for extra shifts and haven't had one lately, so the same two people don't burn out.
4. Overtime, then agency, last.

Most buildings send a group text, and the first yes is often someone already near 40 hours. That's how one call-out turns into time-and-a-half.

Write your order down once, so whoever's on call at 5 a.m. follows the same one.
`);

const LEARNED = D(`
A few things I've learned from watching schedulers work:

The schedule isn't the hard part. Fixing it after is: call-outs, swaps, the vacation nobody mentioned.

Most of the work happens in texts. The spreadsheet is just where it ends up.

Good schedulers carry a list in their head of who'll say yes at 5 a.m. When they're off, nobody else has it.

That last one is what we're building around: getting what's in the scheduler's head into something the whole team can use.
`);

/** LinkedIn Posts 3, 9 and 14, in linkedinPosts.json's shape. */
const LINKEDIN = {
  3: {
    num: 3,
    title: "Three checks before you publish",
    body: `${CHECKS}\n\n#SeniorLiving #Scheduling #NursingLeadership`,
    visual: "A simple checklist graphic with the three checks.",
    when: "Week 1 · Thursday 1:30 PM ET",
  },
  9: {
    num: 9,
    title: "Who to ask first when someone calls out",
    body: `${COVER_ORDER}\n\n#SeniorLiving #NursingLeadership #CNA`,
    visual: "The four steps as a numbered graphic.",
    when: "Week 3 · Thursday 1:30 PM ET",
  },
  14: {
    num: 14,
    title: "What we've learned watching schedulers work",
    body: `Swap in what you've actually seen; keep every line true.\n\n${LEARNED}\n\n#SeniorLiving #Scheduling #NursingLeadership`,
    visual: "None, or a photo of a real (blurred) schedule.",
    when: "Week 5 · Wednesday 4:00 PM ET",
  },
};

/** The two Facebook questions become tips (same items, new title and draft). */
const FACEBOOK = {
  "fb-poll-longest": {
    title: "Share: three checks before you publish the schedule",
    notes: D(`
Only in groups that allow tips, and best as a reply when someone's stuck on the schedule. No link needed.

${CHECKS}
`),
  },
  "fbp-question": {
    title: "Page tip: who to ask first when someone calls out",
    notes: D(`
A tip post on the Page. Pair it with the call-out Reel, or post it on its own.

${COVER_ORDER}
`),
  },
};

const TIP_FORMULA = {
  label: "Tip formula",
  body: D(`
Line 1: the problem in their words ("Three checks before you publish the schedule.").
Then: 3 to 5 numbered steps, one line each, specific enough to do today.
Then: one line on what it saves (an hour, overtime, a 5 a.m. phone call).
No question needed at the end: the tip is the reason to save or share it.
`),
};

const POST_FORMULA = {
  label: "Post formula",
  body: D(`
Line 1: the number or the moment ("5:04 a.m." / "$36,500").
Lines 2–4: the math or the story, three short lines.
Line 5: one thing to do about it this week.
End on that, not on a question for the sake of comments.
First comment: the calculator or template link (not in the post).
No hashtags in the middle; two or three at the end, at most.
`),
};

/** The Facebook Page step that asked for "a question schedulers want to answer". */
const PAGE_STEP = {
  from: "Post 3 times a week: a template or tip, a short video or Reel, and a question schedulers want to answer.",
  to: "Post 3 times a week: a template or tip, a short video or Reel, and a before-and-after or a real example from a schedule.",
};

module.exports = { LINKEDIN, FACEBOOK, TIP_FORMULA, POST_FORMULA, PAGE_STEP };

/** What these looked like before version 23, to tell untouched items from yours. */
const OLD = {
  "linkedin": {
    "3": {
      "num": 3,
      "title": "Poll: what takes the longest?",
      "body": "Schedulers and DONs: what takes the longest when you build the schedule?\n\nBuilding the week\n\nWaiting on time-off answers\n\nGetting it to everyone\n\nFixing it after call-outs\n\nWe are building a scheduling tool for care facilities and I'd rather hear it from the people doing the work. Tell me in the comments what you'd change first.\n\n#SeniorLiving #NursingLeadership #Scheduling",
      "visual": "None; the poll is the visual. Save the results for Post 14.",
      "when": "Week 1 · Thursday 1:30 PM ET"
    },
    "9": {
      "num": 9,
      "title": "Poll: how do you cover a call-out?",
      "body": "Schedulers: when someone calls out at 5 a.m., what's your first move?\n\nText people one by one\n\nGroup text the whole team\n\nCall the agency\n\nWork it yourself\n\nNo wrong answers. I'm collecting what actually happens on the floor.\n\n#SeniorLiving #NursingLeadership #CNA",
      "visual": "None; the poll is the visual. Save the results for Post 14.",
      "when": "Week 3 · Thursday 1:30 PM ET"
    },
    "14": {
      "num": 14,
      "title": "What schedulers told us",
      "body": "Fill in the results from the polls in Posts 3 and 9 before posting.\n\nA few weeks ago I asked schedulers two questions. Here's what you said.\n\nWhat takes the longest? [top answer] won with [X]%, followed by [second answer].\n\nFirst move on a 5 a.m. call-out? [top answer], at [X]%.\n\nWhat stood out to me: [one honest observation from the comments].\n\nThat's what we're building around. Thanks to everyone who answered, and keep the comments coming.\n\n#SeniorLiving #Scheduling #NursingLeadership",
      "visual": "Simple chart of the two poll results.",
      "when": "Week 5 · Wednesday 4:00 PM ET"
    }
  },
  "facebook": {
    "fb-poll-longest": "Same poll as Post 3; bring the answers back for Post 14.\n\nSchedulers: what takes the longest when you build next week's schedule?\n\nA) Getting every shift covered\nB) Call-outs and last-minute changes\nC) Requests off and availability\nD) Something else (tell us!)\n\nDrop a letter below. We'll pull together tips for whatever comes up most.",
    "fbp-question": "Turn the best answers into a tip post.\n\nSchedulers: what takes the longest when you build next week's schedule?\n\nA) Getting every shift covered\nB) Call-outs and last-minute changes\nC) Requests off and availability\nD) Something else (tell us!)\n\nDrop a letter below. We'll share tips for whatever comes up most."
  },
  "pollFormula": {
    "label": "Poll formula",
    "body": "Question: one thing schedulers or leaders argue about (\"How do you cover a call-out?\").\nOptions: four real answers, one of them \"Something else (comment)\".\nFollow-up post a week later: \"Here's what [X] of you said\", plus one tip for the top answer."
  },
  "postFormula": "Line 1: the number or the moment (\"5:04 a.m.\" / \"$36,500\").\nLines 2–4: the math or the story, three short lines.\nLine 5: one thing to do about it this week.\nLast line: a question people can answer in a comment.\nFirst comment: the calculator or template link (not in the post).\nNo hashtags in the middle; two or three at the end, at most.",
  "facebookTitles": {
    "fb-poll-longest": "Ask the group: what takes the longest when you build the schedule?",
    "fbp-question": "Page question: what takes the longest when you build the schedule?"
  },
  "facebookNotes": {
    "fb-poll-longest": "Same poll as Post 3; bring the answers back to Post 14.",
    "fbp-question": "Turn the best answers into a tip post."
  }
};
module.exports.OLD = OLD;
