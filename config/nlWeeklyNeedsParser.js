/**
 * Weekly Needs from plain words (typed or spoken), through POST /nl/parse
 * with formType "weeklyNeeds".
 *
 *   "4 CNAs on day shift weekdays, 3 on weekends, 1 med tech every shift,
 *    nights need 2 aides and a nurse"
 *
 * The model only reads the message and picks from this facility's own shift
 * times, roles and areas (enums in the tool schema). Everything it returns is
 * checked here before the client sees it, and the client merges the rows into
 * the table for review; nothing is saved until the scheduler presses Save.
 *
 * Draft returned to the client:
 *   { rows: [{ shiftType, shiftTag, role, unitArea, countsByWeekday }],
 *     notUnderstood: [string] }
 * countsByWeekday is Sunday-first; null = "not mentioned, keep what's there".
 * The website only ever adds rows or changes the numbers on a row with the
 * same shift + role + area; it never deletes or changes anything else.
 */

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MAX_COUNT = 50;

const lower = (v) => String(v || "").trim().toLowerCase();

function slotList(context) {
  return Object.entries(context.shiftSlotsByType || {}).flatMap(([shiftType, slots]) =>
    (slots || [])
      .filter((slot) => slot.tag)
      .map((slot) => ({
        key: `${shiftType}:${slot.tag}`,
        shiftType,
        shiftTag: slot.tag,
        label: slot.label || slot.tag,
        start: slot.startLocalTime || "",
        end: slot.endLocalTime || "",
      })),
  );
}

function describeGaps(context) {
  const gaps = [];
  if (!context.roleFamilies.length) {
    gaps.push({ field: "roleFamilies", message: "Add your roles in Facility Preferences first." });
  }
  if (!slotList(context).length) {
    gaps.push({ field: "shiftTypeDefinitions", message: "Add your shift times in Facility Preferences first." });
  }
  return gaps;
}

function buildTool(context) {
  const slots = slotList(context);
  const countProp = { type: ["integer", "null"], minimum: 0, maximum: MAX_COUNT };
  return {
    name: "submit_weekly_needs",
    description: "Submit the weekly staffing needs described in the scheduler's message.",
    input_schema: {
      type: "object",
      properties: {
        rows: {
          type: "array",
          description: "One row per shift + role (+ unit area) the message talks about. Leave out anything not mentioned.",
          items: {
            type: "object",
            properties: {
              shift: { type: "string", enum: slots.map((s) => s.key), description: "The facility shift this row is for" },
              role: {
                type: "string",
                enum: context.roleFamilies.map(lower),
                description: "One of the facility's roles",
              },
              ...(context.unitAreas.length
                ? {
                    unitArea: {
                      type: "string",
                      enum: context.unitAreas.map(lower),
                      description: "Only when the message names one of these unit areas; otherwise leave it out",
                    },
                  }
                : {}),
              counts: {
                type: "object",
                description: "People needed each day. null = the message doesn't say for that day.",
                properties: Object.fromEntries(DAYS.map((d) => [d, countProp])),
                required: DAYS,
              },
            },
            required: ["shift", "role", "counts"],
          },
        },
        notUnderstood: {
          type: "array",
          items: { type: "string" },
          description: "Short notes on any part of the message that couldn't be matched (an unknown role or shift, an unclear number).",
        },
      },
      required: ["rows"],
    },
  };
}

function buildSystemPrompt(context) {
  const slots = slotList(context);
  const shiftLines = slots.map((s) => `- ${s.key}: ${s.label} (${s.start}–${s.end})`).join("\n");
  const roleLines = context.roleFamilies.map((r) => `- ${lower(r)}`).join("\n");
  const areaLines = context.unitAreas.length ? context.unitAreas.map((a) => `- ${lower(a)}`).join("\n") : "(none set up)";
  return `You turn a care facility scheduler's description of a normal week into staffing rows.
The message may be typed or spoken (speech-to-text), so expect loose wording and number words.

This facility's shifts (use the key):
${shiftLines}

Roles:
${roleLines}

Unit areas:
${areaLines}

The user message is JSON: { "message": what they said, "currentFormState": { "rules": the rows they have now } }.
Each current rule has shiftType, shiftTag, role, unitArea and countsByWeekday (Sunday first).

Rules:
1. Only return rows the message talks about. Never invent rows.
2. Match shifts by name or time ("days", "morning", "7 to 3", "11-7", "nights"). If two shifts fit equally, pick the one already used in currentFormState, else the first, and add a note.
3. Match roles by meaning: "aides", "caregivers", "nursing assistants" usually mean CNA; "med aide", "med passer" usually mean med tech; "LPN", "RN", "nurse" mean the closest nurse role. If no role fits, add a note instead of guessing.
4. Counts: if no days are given, use the number for all 7 days. "Weekdays" = mon–fri, "weekends" = sat and sun. If the message only changes some days of a row that already exists, set those days and leave the others null.
5. "Every shift" means one row per shift. "No X on nights" means that row with 0 on the days mentioned (every day if none are).
6. Leave unitArea out unless the message names one of the listed areas.
7. Put anything you couldn't match in notUnderstood, in a few plain words.`;
}

function normalizeDraft(draft, context) {
  const slots = new Map(slotList(context).map((s) => [s.key, s]));
  const roles = new Set(context.roleFamilies.map(lower));
  const areas = new Set(context.unitAreas.map(lower));
  const skipped = [];
  const rows = [];
  for (const row of Array.isArray(draft?.rows) ? draft.rows : []) {
    // Anything outside this facility's setup is dropped with a note rather
    // than failing the whole answer.
    const slot = slots.get(lower(row?.shift));
    const role = lower(row?.role);
    const unitArea = row?.unitArea ? lower(row.unitArea) : null;
    if (!slot) { skipped.push(`a shift called "${row?.shift || "?"}"`); continue; }
    if (!roles.has(role)) { skipped.push(`the role "${row?.role || "?"}"`); continue; }
    if (unitArea && !areas.has(unitArea)) { skipped.push(`the unit area "${row.unitArea}"`); continue; }
    const counts = row?.counts && typeof row.counts === "object" ? row.counts : {};
    rows.push({
      shiftType: slot.shiftType,
      shiftTag: slot.shiftTag,
      role,
      unitArea,
      countsByWeekday: DAYS.map((d) => {
        const n = counts[d];
        if (n === null || n === undefined || n === "") return null;
        const v = Math.round(Number(n));
        return Number.isFinite(v) ? Math.max(0, Math.min(MAX_COUNT, v)) : null;
      }),
    });
  }
  // Same shift + role + area twice: later mention wins day by day.
  const merged = new Map();
  for (const row of rows) {
    const key = [row.shiftType, row.shiftTag, row.role, row.unitArea || ""].join("|");
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, countsByWeekday: prev.countsByWeekday.map((n, i) => row.countsByWeekday[i] ?? n) } : row);
  }
  const notUnderstood = [
    ...(Array.isArray(draft?.notUnderstood) ? draft.notUnderstood : []).map((s) => String(s || "").trim()),
    ...[...new Set(skipped)].map((what) => `Left out ${what}: it isn't set up in Facility Preferences`),
  ]
    .filter(Boolean)
    .slice(0, 10);
  const kept = [...merged.values()].filter((row) => row.countsByWeekday.some((n) => n !== null));
  return { rows: kept, notUnderstood };
}

function validateDraft(draft, context) {
  const errors = [];
  const slotKeys = new Set(slotList(context).map((s) => s.key));
  const roles = new Set(context.roleFamilies.map(lower));
  const areas = new Set(context.unitAreas.map(lower));
  if (!draft || !Array.isArray(draft.rows)) {
    return { valid: false, errors: [{ path: "rows", message: "rows must be a list" }] };
  }
  draft.rows.forEach((row, i) => {
    if (!slotKeys.has(`${row.shiftType}:${row.shiftTag}`)) errors.push({ path: `rows[${i}].shift`, message: "Unknown shift" });
    if (!roles.has(row.role)) errors.push({ path: `rows[${i}].role`, message: "Unknown role" });
    if (row.unitArea && !areas.has(row.unitArea)) errors.push({ path: `rows[${i}].unitArea`, message: "Unknown unit area" });
    if (!Array.isArray(row.countsByWeekday) || row.countsByWeekday.length !== 7) {
      errors.push({ path: `rows[${i}].counts`, message: "Need 7 days" });
    } else if (row.countsByWeekday.every((n) => n === null)) {
      errors.push({ path: `rows[${i}].counts`, message: "No numbers given" });
    }
  });
  if (!draft.rows.length && !draft.notUnderstood?.length) {
    errors.push({ path: "rows", message: "Nothing to fill in" });
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  DAYS,
  slotList,
  weeklyNeedsParser: {
    describeGaps,
    buildTool,
    buildSystemPrompt,
    normalizeDraft,
    validateDraft,
  },
};
