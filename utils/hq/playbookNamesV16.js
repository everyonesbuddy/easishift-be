/**
 * Playbook version 16: campaign names and descriptions in plain words.
 * Every name starts with where it happens (Calls, Email, LinkedIn…), so the
 * list reads at a glance, and the descriptions only mention things that exist.
 */
const CAMPAIGNS = {
  "calls-front-desk": {
    title: "Calls: reach the scheduler, offer a free setup",
    steps: [
      "Call the building's main line.",
      "Ask the front desk who makes the nurse and CNA schedule. Get their name and the best time to reach them.",
      "Also ask who the director of nursing and administrator are, and add them on Leaders & contacts.",
      "Offer the scheduler a free setup of next week's schedule, and book a 30-minute call before you hang up.",
      "At the setup, ask whether their DON would want to see overtime before the week starts. They're your next call.",
    ],
  },
  "calls-leadership": {
    title: "Calls: DONs and administrators",
    goal: "A yes to the free one-page overtime summary from one week of their schedule.",
  },
  "email-hprd": {
    title: "Email: DONs and administrators",
    who: "DONs and administrators at buildings that aren't customers yet. Assisted living buildings get the overtime version automatically.",
    goal: "A reply with one week of their schedule, for the free one-page summary.",
    when: "Three emails, on days 1, 4 and 9. Send from your own inbox.",
    steps: [
      "Email 1 asks one question and offers the free one-page summary.",
      "No reply: Email 2 on day 4, Email 3 on day 9. This week puts them on the list for you.",
      "They reply: use the matching Reply script, and tick They replied so the follow-ups stop.",
    ],
  },
  "email-operator": {
    title: "Email: companies with several buildings",
    who: "Owners and management companies with three or more buildings, and their regional directors.",
    goal: "Try WiserShifts free in one of their buildings for a month.",
    when: "Three emails, on days 1, 5 and 12. Send from your own inbox.",
    steps: [
      "Email 1 links to the operators page, which shows the Monday email they'd get.",
      "They reply: pick one building together and set it up with that building's scheduler.",
      "Start with one building. The others come once it's working there.",
    ],
  },
  "linkedin-posts": {
    title: "LinkedIn: one post a week from your profile",
  },
  "newsletter": {
    title: "Email: weekly email to your list (Klaviyo)",
  },
  "calculator-followup": {
    title: "Email: after someone uses a calculator (automatic)",
    goal: "Turn a calculator visit into a free one-page summary or a trial.",
    steps: [
      "Same day: their result in one line, plus how it's worked out.",
      "Day 3: what WiserShifts shows every week for the same number, with a screenshot of the Labor page.",
      "Day 7: ask if they'd like it every Monday for their building. Try it free, or reply and you'll set it up with their scheduler.",
    ],
  },
  "youtube-howto": {
    title: "YouTube: scheduler how-to videos",
  },
  "search-templates": {
    title: "Google: free templates and how-to posts",
  },
  "facebook-groups": {
    title: "Facebook: groups (as the Page)",
  },
  "facebook-page": {
    title: "Facebook: the WiserShifts Page",
  },
};

// The scheduler setup script named the old campaign; this is the same script with the new name.
const SETUP_SCRIPT_FROM = "[Add them on Leaders & contacts. They're your next call: \"The leadership follow-up call\".]";
const SETUP_SCRIPT_TO = "[Add them on Leaders & contacts. They're your next call, on \"Calls: DONs and administrators\".]";

// Version 17: the search campaign is the blog, so it's called that, and its steps say posts count by themselves.
const BLOG_V17 = {
  title: "Blog (for Google and SEO)",
  steps: [
    "One blog post or printable template every two weeks, written for one thing people search (\"CNA schedule template\", \"how to calculate hours per resident day\").",
    "Publish it on the blog in Contentful. It counts here by itself, and a saved idea with the same title comes off the list.",
    "Every post ends with the matching calculator and Start free.",
    "Check Web & search to see which searches find us, and write more of those.",
  ],
};

module.exports = { CAMPAIGNS, SETUP_SCRIPT_FROM, SETUP_SCRIPT_TO, BLOG_V17 };
