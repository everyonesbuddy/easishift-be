/**
 * The one next step a workspace should take to get WiserShifts going, as a
 * pure function. Earlier steps come first: finish setup, add staff, add
 * phone numbers, publish this week, publish next week, get staff to say yes
 * to texts. null when nothing's missing.
 */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Steps about getting started stop after this long, so an abandoned signup isn't nagged forever.
const GETTING_STARTED_DAYS = 45;

/**
 * s: {
 *   createdAt, setupDone,
 *   staff, staffWithPhone, optedIn, smsPlan,
 *   thisWeekPublished, nextWeekPublished,
 *   weekday,      // 1 = Monday … 7 = Sunday, facility time
 *   openThisWeek, // unfilled slots in this week's published schedule
 * }
 * link(path) builds an app link.
 */
function nextStep(s, link, now = new Date()) {
  const young = !s.createdAt || now - new Date(s.createdAt) < GETTING_STARTED_DAYS * 864e5;
  if (!s.setupDone) {
    return young ? { key: "setup", text: "Finish setting up WiserShifts. Four short steps, about 5 minutes, and your first week is drafted for you.", link: link("/setup") } : null;
  }
  if (!s.staff) {
    return young ? { key: "staff", text: "Add your staff so you can build the schedule. Paste a list from a spreadsheet; nobody needs a login.", link: link("/staffs") } : null;
  }
  if (!s.staffWithPhone) {
    return { key: "phones", text: `Add phone numbers for your ${plural(s.staff, "staff member")} so they get their shifts, and open shifts to pick up, by text.`, link: link("/staffs") };
  }
  if (!s.thisWeekPublished && !s.nextWeekPublished) {
    return { key: "publish", text: "Your schedule isn't published yet. Publish this week and everyone gets their shifts on their phone, and call-outs can be filled by text.", link: link("/schedule") };
  }
  if (s.thisWeekPublished && !s.nextWeekPublished && s.weekday >= 4) {
    return { key: "publish_next", text: "Next week isn't published yet. Publish it by Friday so your staff can plan. Auto-fill can draft it for you.", link: link("/schedule") };
  }
  if (s.smsPlan && s.staffWithPhone >= 3 && s.optedIn / s.staffWithPhone < 0.5) {
    const waiting = s.staffWithPhone - s.optedIn;
    return { key: "optin", text: `${plural(waiting, "staff member")} haven't said yes to WiserShifts texts, so they won't hear about open shifts. Ask them to reply YES to the text from WiserShifts.`, link: link("/staffs") };
  }
  return null;
}

/** A nudge on its own (no morning summary that day): short, one step, one link. */
function buildNudge(step, facility, manager) {
  const name = String(manager?.name || "").trim().split(/\s+/)[0] || "there";
  const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const button = { setup: "Finish setup", staff: "Add staff", phones: "Add phone numbers", publish: "Publish the schedule", publish_next: "Publish next week", optin: "See who hasn't said yes" }[step.key] || "Open WiserShifts";
  return {
    sms: `WiserShifts · ${facility}: Hi ${name}. ${step.text} ${step.link}`,
    subject: { setup: `Finish setting up ${facility}`, staff: `Add your staff to ${facility}`, phones: `Your staff can't get texts yet`, publish: `${facility}: publish your schedule`, publish_next: `${facility}: next week isn't published yet`, optin: `Some of your staff won't hear about open shifts` }[step.key] || `${facility}: next step`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;font-size:15px;line-height:1.55;color:#1D1D1F">
<p>Hi ${esc(name)},</p><p>${esc(step.text)}</p>
<p style="margin:18px 0"><a href="${esc(step.link)}" style="display:inline-block;background:#007AFF;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:10px">${esc(button)}</a></p>
<p style="font-size:12px;color:#6E6E73">WiserShifts sends one of these on Mondays, Wednesdays and Fridays until it's done. Turn it off with the morning summary switch in your notification settings.</p></div>`,
  };
}

module.exports = { nextStep, buildNudge, GETTING_STARTED_DAYS };
