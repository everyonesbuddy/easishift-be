/**
 * HQ "to do now" for content and weekly pace, mixed into the same list as
 * people to contact: content that's overdue or due soon, plays that are
 * behind their weekly target (with what to publish next), and content that
 * did well enough to do again. Pure, like plays.js.
 */
const DAY = 24 * 60 * 60 * 1000;

// Content plan channel → playbook channel (for the channel tag and page).
const CHANNEL = { youtube: "youtube", linkedin: "linkedin", blog: "blog", website: "blog", newsletter: "newsletter", email: "newsletter", facebook: "facebook", other: "other" };

// What a logged touch is, for plays counted from logged touches.
const LOG_KIND = { calls: "call", email: "email", linkedin: "linkedin" };

const metricValue = (m) => (!m || m.pending ? null : m.views ?? m.impressions ?? null);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const dayName = (d) => new Date(d).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

/**
 * @param {Array} items content items (with metrics for published ones)
 * @param {Array} plays playbook plays, each with done = this week's count
 * @param {Date} now
 * @param {number} dayOfWeek 0 = Monday … 6 = Sunday (team time zone)
 * @param {string} weekKey this week's Monday, "2026-10-26"
 */
function buildContentPlays({ items = [], plays = [], now = new Date(), dayOfWeek = 0, weekKey = "", doneKeys = new Set() }) {
  const out = [];
  const add = (p) => {
    if (!doneKeys.has(p.key)) out.push(p);
  };
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  const open = items.filter((i) => i.status !== "published");
  const playById = new Map(plays.map((p) => [String(p._id), p]));

  // Overdue and due soon.
  for (const i of open) {
    if (!i.dueDate) continue;
    const due = new Date(i.dueDate);
    const days = Math.floor((due - today) / DAY);
    if (days > 3) continue;
    const play = i.playId ? playById.get(String(i.playId)) : null;
    add({
      key: `content:${i._id}:${String(i.dueDate).slice(0, 10)}:${i.status}`,
      kind: days < 0 ? "overdue" : "content",
      channel: CHANNEL[i.channel] || "other",
      priority: days <= 0 ? 1 : 2,
      audiences: i.audience?.length ? i.audience : play?.audience || [],
      contentId: String(i._id),
      item: i,
      title: days < 0 ? `Overdue: ${i.title}` : `${days === 0 ? "Due today" : `Due ${dayName(due)}`}: ${i.title}`,
      why: `${i.status === "idea" ? "Still an idea" : i.status === "drafting" ? "Being drafted" : i.status === "ready" ? "Ready to publish" : "Scheduled"}${i.owner ? `, ${i.owner}` : ""}${play ? ` · ${play.title}` : ""}.`,
      action: i.status === "ready" || i.status === "scheduled" ? "Publish it, then paste the link so its numbers show up." : days < 0 ? "Finish it, or move the date." : "Get it to Ready before the due date.",
    });
  }

  // Weekly pace for every running play with a target.
  const workdaysGone = Math.min(5, dayOfWeek + 1);
  for (const p of plays) {
    if (!p.active || !p.weeklyTarget || p.countsFrom === "leads" || p.countsFrom === "signups" || p.countsFrom === "none") continue;
    const done = p.done ?? 0;
    if (p.weeklyTarget < 1) {
      // Every few weeks (e.g. the newsletter): due when nothing went out in that time.
      const every = Math.round(1 / p.weeklyTarget) * 7;
      const last = items.filter((i) => String(i.playId) === String(p._id) && i.status === "published" && i.publishedAt).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))[0];
      if (last && now - new Date(last.publishedAt) < every * DAY) continue;
      const next = open
        .filter((i) => String(i.playId) === String(p._id))
        .sort((a, b) => new Date(a.dueDate || 8.64e15) - new Date(b.dueDate || 8.64e15) || String(a.title).localeCompare(String(b.title), "en", { numeric: true }))[0];
      add({
        key: `cadence:${p._id}:${weekKey}`,
        kind: "cadence",
        channel: p.channel,
        priority: 1,
        audiences: p.audience,
        playId: String(p._id),
        contentId: next ? String(next._id) : null,
        item: next || null,
        title: `${p.title} is due`,
        why: last ? `The last one went out ${Math.floor((now - new Date(last.publishedAt)) / DAY)} days ago.` : "Nothing has gone out yet.",
        action: next ? `Next up: "${next.title}". Mark it published here once it's out.` : "Add the next one to the content plan.",
      });
      continue;
    }
    if (done >= p.weeklyTarget) continue;
    const expected = Math.floor((p.weeklyTarget * workdaysGone) / 5);
    const behind = done < expected;
    if (!behind && dayOfWeek < 2) continue; // early in the week and on pace: no nag
    const next =
      p.countsFrom === "content"
        ? open
            .filter((i) => String(i.playId) === String(p._id))
            .sort(
              (a, b) =>
                ["ready", "scheduled", "drafting", "idea"].indexOf(a.status) - ["ready", "scheduled", "drafting", "idea"].indexOf(b.status) ||
                new Date(a.dueDate || 8.64e15) - new Date(b.dueDate || 8.64e15) ||
                // No dates: go in order ("Post 4" before "Post 15").
                String(a.title).localeCompare(String(b.title), "en", { numeric: true }),
            )[0]
        : null;
    const unit = p.targetUnit || "";
    add({
      // One per play per week: "Skip this week" hides it until next Monday.
      key: `cadence:${p._id}:${weekKey}`,
      progress: { done, target: p.weeklyTarget, unit: p.targetUnit || "" },
      countsFrom: p.countsFrom,
      logKind: LOG_KIND[p.channel] || "note",
      kind: "cadence",
      channel: p.channel,
      priority: behind ? 1 : 2,
      audiences: p.audience,
      playId: String(p._id),
      contentId: next ? String(next._id) : null,
      item: next || null,
      title: `${p.title}: ${done} of ${p.weeklyTarget} ${unit} this week`,
      why: behind ? `Behind pace: about ${expected} by today.` : "On pace, but not there yet.",
      action:
        p.countsFrom === "content"
          ? next
            ? `Publish next: "${next.title}" (${next.status}), then mark it published here. Nothing to log.`
            : "Add the next piece to the content plan. It counts once it's marked published."
          : `${p.weeklyTarget - done} to go. Log each one with this play so it counts.`,
    });
  }

  // Did well: do more like it.
  const published = items.filter((i) => i.status === "published" && metricValue(i.metrics) !== null);
  const byChannel = new Map();
  for (const i of published) byChannel.set(i.channel, [...(byChannel.get(i.channel) || []), i]);
  for (const [channel, list] of byChannel) {
    if (list.length < 3) continue;
    const mid = median(list.map((i) => metricValue(i.metrics)));
    for (const i of list) {
      const v = metricValue(i.metrics);
      if (!mid || v < mid * 1.5 || now - new Date(i.publishedAt || 0) > 45 * DAY) continue;
      const unit = i.metrics.views !== undefined ? "views" : "impressions";
      add({
        key: `didwell:${i._id}`,
        kind: "didwell",
        channel: CHANNEL[channel] || "other",
        priority: 2,
        audiences: i.audience || [],
        contentId: String(i._id),
        item: i,
        title: `Do another like "${i.title}"`,
        why: `${v.toLocaleString("en-US")} ${unit}, against a usual ${Math.round(mid).toLocaleString("en-US")} for this channel.`,
        action: "Add a follow-up on the same topic (or the same format) to the content plan, and reuse it in the newsletter.",
      });
    }
  }

  return out;
}

module.exports = { buildContentPlays, median };
