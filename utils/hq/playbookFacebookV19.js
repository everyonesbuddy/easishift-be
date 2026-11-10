/**
 * Playbook version 19: Facebook groups as one play that fits every group.
 *
 * Group rules vary, but they all allow the same thing: give, don't pitch;
 * never DM first or write "message me"; offer only once an admin says yes.
 * Doing only that fits even the strictest group, so nothing is tailored per
 * group except whether an offer is allowed (set on the group in HQ).
 *
 * Facebook is a small channel for us: about an hour a week, 2 group
 * touches, leaning in on small residential homes (RAL groups), where the
 * owner is the buyer. If it brings no setup call or signup in 8 weeks, pause it.
 */

const GOAL = "Be the helpful Page in a few groups, about an hour a week. Give, don't pitch; offer only where an admin said yes.";

const WHO = "Schedulers, nurse leaders and owners of small residential homes (RAL groups) in the groups on HQ's Facebook page.";

const STEPS = [
  "One play for every group: give, don't pitch. It fits even the strictest rules, so there's nothing to tailor per group.",
  "Before posting in a new group, read its rules and set what it allows on the group in HQ (ask the admin first, no promotion, and so on).",
  "Every week: answer a couple of real questions or post one useful thing (a tip, the call-out math, a template as a picture or PDF). Write it in the post; no links to our site.",
  "Never DM first, and never write \"message me\" or \"contact us\". Only message people who asked: they commented yes on an approved offer, or messaged the Page.",
  "Offer only where the admin said yes or the rules allow it. Ask the admin first with the script; one follow-up after 5 days, then let it go.",
  "Lean in on small residential homes (RAL groups): the owner is the buyer, and covering 24/7 with a few caregivers is their headache.",
  "Notice the words people use when they complain about scheduling, and reuse them in emails, blog posts and call scripts.",
  "The test: if Facebook hasn't brought a setup call or signup in 8 weeks, pause this campaign and put the hour into calls.",
];

const VOLUME = "About an hour a week: 2 group touches (answers or helpful posts), plus anyone who asks to hear from us.";
const WEEKLY_TARGET = 2;

const SCRIPTS = [
  {
    label: "Message to the admin · Before any offer",
    body: `Hi [admin name], thanks for running [group]. I'm [your name] from WiserShifts; we make scheduling software for care homes.

I've made a free printable caregiver schedule, including a 24/7 rotation for small homes, and I'd love to share it with your members. No strings, and no links if you'd rather. Would that be okay, or would you prefer to post it yourself?

Happy to go with whatever you decide.`,
  },
  {
    label: "Admin follow-up · Once, after 5 days",
    body: `Hi [admin name], just checking whether sharing the free schedule template would be okay in [group]. Totally fine if not; we'll keep answering questions either way.`,
  },
  {
    label: "Answer to a question · No pitch, no link",
    body: `We see this a lot. What works for most homes: [the answer, in two or three lines].

[If a template would help:] Happy to post the printable version here if it's useful.`,
  },
  {
    label: "Post · Small homes: covering 24/7 with 4 caregivers",
    body: `Small homes: how do you cover 24/7 with four caregivers?

One rotation that works: 12-hour shifts, one person on days and one on nights, on a 2-2-3 pattern (two on, two off, three on, then the opposite). Everyone gets every other weekend off.

It averages 42 hours a week, but how that splits depends on where your pay week starts: 36 and 48 on alternate weeks, or as uneven as 60 and 24. Line it up with your pay week before you commit, so the overtime isn't a surprise.

[Attach the rotation as a picture.] How do you do it in your home?`,
  },
  {
    label: "Post · What one call-out costs",
    body: `Quick math on call-outs: when someone calls out of a 12-hour shift and a coworker covers it on overtime, the extra half-pay at $18 an hour is about $108, for that one shift.

Two a week is over $11,000 a year.

What's helped you cut down on last-minute call-outs?`,
  },
  {
    label: "Post · Ask the group",
    body: `Schedulers and owners: what takes the longest when you build next week's schedule? Covering call-outs, time-off requests, keeping people under 40 hours, something else?`,
  },
  {
    label: "The offer · Only where the admin said yes",
    body: `Schedulers and owners: we're building next week's schedule free with a few homes this month, mostly to learn what's hardest for you. If you'd like one, comment "yes" below and we'll reach out.`,
  },
  {
    label: "Message · Only to someone who asked",
    body: `Hi [name], thanks for asking! What days and times work for a 30-minute call this week? Send over your current schedule whenever (a photo is fine) and we'll have it ready to go.`,
  },
  {
    label: "Follow-up · Once, only to someone who asked",
    body: `Hi [name], just following up on the free schedule setup. Still happy to build next week's schedule with you if it would help. Any time this week?`,
  },
];

module.exports = { GOAL, WHO, STEPS, VOLUME, WEEKLY_TARGET, SCRIPTS };
