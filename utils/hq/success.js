/**
 * HQ customer success, as pure functions: how healthy a customer is, the
 * checklist for the stage they're in, when to check in next, and the to-dos
 * for This week.
 *
 * Mildly aggressive on purpose: weekly check-ins for the first 90 days,
 * warning signs flagged early (next week not published by Thursday, staff
 * not saying yes to texts, managers not logging in, a late payment), and an
 * at-risk customer gets a call within one business day.
 */
const DAY = 24 * 60 * 60 * 1000;

const STAGES = {
  onboarding: "Onboarding",
  steady: "Running smoothly",
  at_risk: "At risk",
  renewal: "Renewal coming",
  churned: "Left",
};

const pct = (a, b) => (b ? a / b : 0);
const daysSince = (d, now) => (d ? Math.floor((now - new Date(d)) / DAY) : null);

/**
 * Green, yellow or red, with the reasons in plain words (worst first).
 * s: the workspace's signals (see the controller's signalsFor).
 */
function health(s, { now = new Date(), startedAt } = {}) {
  const red = [];
  const yellow = [];
  const age = daysSince(startedAt, now) ?? 0;
  const seen = daysSince(s.lastManagerSeenAt, now);

  if (s.subscriptionStatus === "past_due" || s.subscriptionStatus === "unpaid") red.push("Their payment failed");
  if (s.overdueDays > 0) (s.overdueDays > 7 ? red : yellow).push(`An invoice is ${s.overdueDays} day${s.overdueDays === 1 ? "" : "s"} overdue`);

  if (!s.staff) (age > 7 ? red : yellow).push("No staff added yet");
  if (!s.thisWeekPublished) (age > 7 ? red : yellow).push("This week isn't published in WiserShifts");
  if (!s.nextWeekPublished && s.weekday >= 4) yellow.push("Next week isn't published yet");

  if (seen === null) (age > 7 ? red : yellow).push("No manager has logged in yet");
  else if (seen >= 10) red.push(`No manager has logged in for ${seen} days`);
  else if (seen >= 5) yellow.push(`No manager has logged in for ${seen} days`);

  if (s.smsPlan && s.staff) {
    if (pct(s.staffWithPhone, s.staff) < 0.8) yellow.push(`Only ${s.staffWithPhone} of ${s.staff} staff have a phone number`);
    else if (pct(s.optedIn, s.staffWithPhone) < 0.5) yellow.push(`Only ${s.optedIn} of ${s.staffWithPhone} staff said yes to texts`);
  }
  if (s.staff && age > 14 && !s.staffOpened14) yellow.push("No staff opened their schedule in the last 2 weeks");

  const level = red.length ? "red" : yellow.length ? "yellow" : "green";
  return { level, reasons: [...red, ...yellow] };
}

/**
 * The checklist for each stage. Items with check(s) tick themselves from
 * the workspace's data. Steady items are per month; at-risk and renewal
 * items start fresh each time a customer enters that stage.
 */
const CHECKLISTS = {
  onboarding: [
    { key: "kickoff", text: "Kickoff visit or call with the owner and the scheduler" },
    { key: "staff", text: "Staff added", check: (s) => s.staff > 0 },
    { key: "phones", text: "Phone numbers for at least 9 in 10 staff", check: (s) => s.staff > 0 && pct(s.staffWithPhone, s.staff) >= 0.9 },
    { key: "managers_texts", text: "Managers said yes to texts", check: (s) => s.managersOptedIn > 0 },
    { key: "staff_texts", text: "At least half the staff said yes to texts", check: (s) => s.staffWithPhone > 0 && pct(s.optedIn, s.staffWithPhone) >= 0.5 },
    { key: "published", text: "This week published in WiserShifts", check: (s) => s.thisWeekPublished },
    { key: "next_published", text: "Next week published before it starts", check: (s) => s.nextWeekPublished },
    { key: "callout", text: "First call-out filled by text", check: (s) => s.calloutsFilled30 > 0 },
    { key: "day7", text: "Day 7 check-in" },
    { key: "day14", text: "Day 14 check-in" },
    { key: "day30", text: "Day 30 review: what's working, and one number that shows it" },
  ],
  steady: [
    { key: "number", text: "Send them one number this month (call-outs filled, overtime caught)", monthly: true },
    { key: "annoy", text: "Ask what's annoying them, and fix one thing", monthly: true },
    { key: "ask", text: "After 60 good days: ask for a testimonial or a referral" },
  ],
  at_risk: [
    { key: "call", text: "Call within one business day" },
    { key: "blocker", text: "Find the one blocker: what, who, since when" },
    { key: "session", text: "Offer a working session this week, on site or by screen share" },
    { key: "fix", text: "Agree one fix, with a date" },
    { key: "follow", text: "Follow up 3 days later" },
  ],
  renewal: [
    { key: "summary", text: "Send one page on what WiserShifts did for them" },
    { key: "talk", text: "Renewal conversation with the owner" },
    { key: "billing", text: "Confirm the card on file or who gets the invoice" },
  ],
  churned: [{ key: "why", text: "Write down why they left, in their words" }],
};

const monthOf = (d) => new Date(d).toISOString().slice(0, 7);
/** Where a checklist tick is stored, so monthly and per-stage items start fresh. */
function doneKey(stage, item, { now = new Date(), stageAt } = {}) {
  if (item.monthly) return `${stage}:${item.key}:${monthOf(now)}`;
  if (stage === "at_risk" || stage === "renewal" || stage === "churned") return `${stage}:${item.key}:${new Date(stageAt || 0).toISOString().slice(0, 10)}`;
  return `${stage}:${item.key}`;
}

/** The stage's checklist with what's done: ticked by hand, or by the data. */
function checklist(c, s, now = new Date()) {
  const done = c.done instanceof Map ? Object.fromEntries(c.done) : c.done || {};
  return (CHECKLISTS[c.stage] || []).map((item) => {
    const key = doneKey(c.stage, item, { now, stageAt: c.stageAt });
    const auto = Boolean(item.check && s && item.check(s));
    return { key, text: item.text, auto: Boolean(item.check), done: auto || Boolean(done[key]), doneAt: done[key] || null, monthly: Boolean(item.monthly) };
  });
}

/** Days until the next check-in after one happens: weekly for 90 days, then every two weeks; at risk, every 3 days. */
function cadenceDays(stage, startedAt, now = new Date()) {
  if (stage === "at_risk") return 3;
  if (stage === "steady") return (daysSince(startedAt, now) ?? 0) < 90 ? 7 : 14;
  if (stage === "churned") return null;
  return 7;
}

/** The next business day (Mon to Fri) after now. */
function nextBusinessDay(now = new Date()) {
  const d = new Date(now.getTime() + DAY);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setTime(d.getTime() + DAY);
  return d;
}

const short = (d, tz) => new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(tz ? { timeZone: tz } : {}) });

/**
 * This week's to-dos: check-ins due within a day (or overdue), and
 * customers who turned red without being moved to At risk yet.
 * customers: [{ _id, name, owner, stage, nextCheckInAt, health }]
 */
function todos(customers, { now = new Date(), tz } = {}) {
  const out = [];
  for (const c of customers) {
    if (c.stage === "churned") continue;
    const base = { refId: String(c._id), customer: c.name, owner: c.owner || "" };
    if (c.health?.level === "red" && c.stage !== "at_risk") {
      out.push({ ...base, kind: "red", at: now, title: `${c.name} turned red: call within one business day`, detail: c.health.reasons[0] || "" });
    }
    if (c.nextCheckInAt && new Date(c.nextCheckInAt) - now <= DAY) {
      const late = new Date(c.nextCheckInAt) < now;
      out.push({ ...base, kind: late ? "late" : "checkin", at: new Date(c.nextCheckInAt), title: `${late ? "Overdue: check" : "Check"} in with ${c.name} (${short(c.nextCheckInAt, tz)})`, detail: c.health?.reasons?.[0] ? `Ask about: ${c.health.reasons[0].toLowerCase()}` : "" });
    }
  }
  const order = { red: 0, late: 1, checkin: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.at - b.at);
}

module.exports = { STAGES, CHECKLISTS, health, checklist, doneKey, cadenceDays, nextBusinessDay, todos, DAY };
