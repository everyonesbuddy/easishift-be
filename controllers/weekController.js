/**
 * Weeks — everything the schedule screen needs in one call.
 *
 * GET /api/v1/weeks/current                      -> { weekStart }
 * GET /api/v1/weeks/:weekStart                   -> week, coverage, schedules, staff, time off
 * GET /api/v1/weeks/:weekStart/candidates?coverageId=  -> who can take a slot
 * GET /api/v1/weeks?from=&to=                    -> summaries; opens each week (month/roster views)
 * POST /api/v1/weeks/:weekStart/slots            -> add a one-off need on one day
 */
const mongoose = require("mongoose");
const { DateTime } = require("luxon");
const { parseSection, inSection, sectionResponse } = require("../utils/sections");
const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const TimeOff = require("../models/timeOffModel");
const User = require("../models/userModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const { tagKey } = require("../utils/tagKey");
const Preferences = require("../models/preferencesModel");
const { getEffectivePlanKey } = require("../config/plans");
const {
  assertNotOverLimit,
  getUsage,
  canUseGraceWeek,
} = require("../utils/planLimits");
const {
  sendToStaff,
  shortShift,
  shortWeek,
  firstName,
  escapeHtml,
} = require("../utils/notify");

const { getStaffLinkUrl } = require("../utils/staffLinks");

const linkForStaff = (person) => getStaffLinkUrl(person);
const { countAssignmentsByCoverage } = require("../utils/scheduleUtils");
const {
  dateKeyToCoverageDate,
  coverageDateToKey,
  weekDays,
  weekBounds,
  weekStartFor,
  addDaysToKey,
} = require("../utils/dateUtils");
const {
  getWeekSettings,
  ensureWeek,
  buildTemplateOps,
  assertWeekStart,
} = require("../utils/weekService");
const { isDateKey, buildShiftSlotLookup } = require("../utils/dateUtils");
const {
  getCompatibleFacilityConfig,
  eligibleStaffForCoverage,
} = require("../utils/eligibility");

const STAFF_FIELDS =
  "name role roles allowedShiftTypes allowedAreas certificationTags phoneE164 email smsConsent";

const toWeekStaff = (person) => ({
  _id: person._id,
  name: person.name,
  roles: person.roles || [],
  allowedShiftTypes: person.allowedShiftTypes || [],
  allowedAreas: person.allowedAreas || [],
  certificationTags: person.certificationTags || [],
  hasPhone: Boolean(person.phoneE164),
  hasEmail: Boolean(person.email),
  smsStatus: person.smsConsent?.status || "none",
});

// Fingerprint of one person's shifts in a week (what their last message
// said). Used to skip messages when changes cancel out.
const shiftSignature = (shifts) =>
  [...shifts]
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .map((x) => `${new Date(x.startTime).getTime()}-${new Date(x.endTime).getTime()}-${x.role}-${x.unitArea || ""}`)
    .join("|");

const toWeekResponse = (week) => ({
  _id: week._id,
  weekStart: coverageDateToKey(week.weekStart),
  status: week.status,
  publishedAt: week.publishedAt,
  lastPublish: week.lastPublish,
});

exports.getCurrentWeek = async (req, res, next) => {
  try {
    const { timezone, weekStartsOn } = await getWeekSettings(req.tenantId);
    const weekStart = weekStartFor(new Date(), timezone, weekStartsOn);
    res.json({
      weekStart,
      previous: addDaysToKey(weekStart, -7),
      next: addDaysToKey(weekStart, 7),
      timezone,
      weekStartsOn,
    });
  } catch (err) {
    next(err);
  }
};

exports.getWeek = async (req, res, next) => {
  try {
    const { weekStart } = req.params;
    const settings = await getWeekSettings(req.tenantId);
    const week = await ensureWeek({ tenantId: req.tenantId, weekStart, settings });

    const days = weekDays(weekStart);
    const { start, end } = weekBounds(weekStart, settings.timezone);

    const [coverage, schedules, staff, timeOff] = await Promise.all([
      Coverage.find({
        tenantId: req.tenantId,
        date: { $in: days.map(dateKeyToCoverageDate) },
      })
        .sort({ startTime: 1, role: 1 })
        .lean(),
      Schedule.find({
        tenantId: req.tenantId,
        startTime: { $gte: start, $lt: end },
      })
        .populate("staffId", "name roles")
        .sort({ startTime: 1 })
        .lean(),
      User.find({
        tenantId: req.tenantId,
        loginEnabled: false,
        status: "active",
      })
        .select(STAFF_FIELDS)
        .sort({ name: 1 })
        .lean(),
      TimeOff.find({
        tenantId: req.tenantId,
        status: { $in: ["pending", "approved"] },
        startTime: { $lt: end },
        endTime: { $gt: start },
      })
        .populate("staffId", "name")
        .lean(),
    ]);

    const assigned = await countAssignmentsByCoverage({
      tenantId: req.tenantId,
      coverageIds: coverage.map((row) => row._id),
    });

    let openSlots = 0;
    const coverageRows = coverage.map((row) => {
      const assignedCount = assigned.get(String(row._id)) || 0;
      const remaining = Math.max(0, row.requiredCount - assignedCount);
      openSlots += remaining;
      return {
        ...row,
        dateKey: coverageDateToKey(row.date),
        assignedCount,
        remaining,
      };
    });

    res.json({
      week: toWeekResponse(week),
      timezone: settings.timezone,
      days,
      coverage: coverageRows,
      schedules,
      staff: staff.map(toWeekStaff),
      timeOff,
      counts: {
        openSlots,
        shifts: schedules.filter((s) => s.status !== "call_out").length,
        callOuts: schedules.filter((s) => s.status === "call_out").length,
        unpublishedChanges: schedules.filter((s) => s.state === "draft").length,
        // "Not sent yet" by role + area, for "Publish a section".
        notSentSections: (() => {
          const groups = new Map();
          for (const shift of schedules) {
            if (shift.state !== "draft" || shift.status === "call_out") continue;
            const key = `${shift.role || ""}|${shift.unitArea || ""}`;
            if (!groups.has(key)) {
              groups.set(key, { role: shift.role || null, unitArea: shift.unitArea || null, shifts: 0, people: new Set() });
            }
            const g = groups.get(key);
            g.shifts += 1;
            g.people.add(String(shift.staffId?._id || shift.staffId));
          }
          return [...groups.values()].map((g) => ({ ...g, people: g.people.size }));
        })(),
        // People who'd get a message if the scheduler pressed Send now.
        pendingPeople: (() => {
          const touched = new Set([
            ...schedules
              .filter(
                (s) =>
                  s.state === "draft" ||
                  (week.publishedAt && s.updatedAt && new Date(s.updatedAt) > new Date(week.publishedAt)),
              )
              .map((s) => String(s.staffId?._id || s.staffId)),
            ...(week.pendingStaffIds || []).map(String),
          ]);
          if (week.status !== "published") return touched.size;
          const sigs = week.sentSignatures || new Map();
          return [...touched].filter((id) => {
            const mine = schedules.filter(
              (s) => String(s.staffId?._id || s.staffId) === id && s.status !== "call_out",
            );
            return (sigs.get ? sigs.get(id) : sigs[id]) !== shiftSignature(mine);
          }).length;
        })(),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getCandidates = async (req, res, next) => {
  try {
    const { weekStart } = req.params;
    const { coverageId } = req.query;
    if (!coverageId || !mongoose.isValidObjectId(coverageId)) {
      return res.status(400).json({ message: "Valid coverageId is required" });
    }

    const settings = await getWeekSettings(req.tenantId);
    await ensureWeek({ tenantId: req.tenantId, weekStart, settings });

    const [coverage, prefs] = await Promise.all([
      Coverage.findOne({ _id: coverageId, tenantId: req.tenantId }).lean(),
      FacilityPreferences.findOne({ tenantId: req.tenantId }).lean(),
    ]);
    if (!coverage) return res.status(404).json({ message: "Coverage not found" });

    const { start, end } = weekBounds(weekStart, settings.timezone);
    const candidates = await eligibleStaffForCoverage({
      tenantId: req.tenantId,
      coverage,
      facilityConfig: getCompatibleFacilityConfig(prefs),
      weekStart: start,
      weekEnd: end,
      overtimeThresholdMinutes:
        (prefs?.weeklyOvertimeThresholdHours || 40) * 60,
    });

    res.json(
      candidates.map((row) => ({
        staffId: row.staff._id,
        name: row.staff.name,
        roles: row.staff.roles || [],
        eligible: row.eligible,
        reasons: row.reasons,
        weekHours: Math.round((row.weekMinutes / 60) * 10) / 10,
        overtimeIfAssigned: row.overtimeIfAssigned,
      })),
    );
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/weeks/:weekStart/publish
 * Body: { includeEveryone?: boolean, resendAll?: boolean }
 *
 * Publishes the week's draft shifts and sends each person ONE message with
 * their shifts. Publishing again later only messages people whose shifts
 * changed since the last publish (unless resendAll).
 */
exports.publishWeek = async (req, res, next) => {
  try {
    const { weekStart } = req.params;
    const includeEveryone = req.body?.includeEveryone === true;
    const resendAll = req.body?.resendAll === true;
    // Only some roles/areas ("Publish a section"); null = the whole week.
    const section = parseSection(req.body);

    const settings = await getWeekSettings(req.tenantId);
    const week = await ensureWeek({ tenantId: req.tenantId, weekStart, settings });

    // Over the plan's limits (e.g. trial ended with 40 staff): no new weeks,
    // except one grace week right after a trial ends. Sending changes to a
    // week that's already out is always allowed.
    let usedGraceWeek = false;
    if (week.status !== "published" && (await getUsage(req)).overLimit) {
      if (canUseGraceWeek(req.tenant, weekStart)) usedGraceWeek = true;
      else await assertNotOverLimit(req);
    }
    const { start, end } = weekBounds(weekStart, settings.timezone);
    const now = new Date();
    const firstPublish = week.status !== "published";
    const previousPublishedAt = week.publishedAt;

    const inWeek = {
      tenantId: req.tenantId,
      startTime: { $gte: start, $lt: end },
    };

    // Who has changes in this publish (drafts going live, or edits since).
    const changed = (
      await Schedule.find({
        ...inWeek,
        $or: [
          { state: "draft" },
          ...(previousPublishedAt
            ? [{ updatedAt: { $gt: previousPublishedAt } }]
            : []),
        ],
      })
        .select("staffId role unitArea state")
        .lean()
    ).filter((row) => inSection(row, section));
    const changedStaffIds = new Set(changed.map((row) => String(row.staffId)));
    // Changed or removed since the last send (removed shifts leave no row).
    // For a section, only people who still have a shift in it; the others
    // stay pending for the next send.
    const pendingIds = (week.pendingStaffIds || []).map(String);
    if (!section) {
      for (const id of pendingIds) changedStaffIds.add(id);
    } else if (pendingIds.length) {
      const inSectionNow = await Schedule.find({
        ...inWeek,
        staffId: { $in: pendingIds },
      })
        .select("staffId role unitArea")
        .lean();
      for (const row of inSectionNow) {
        if (inSection(row, section)) changedStaffIds.add(String(row.staffId));
      }
    }

    const goingLive = changed.filter((row) => row.state === "draft").map((row) => row._id);
    await Schedule.updateMany(
      section ? { _id: { $in: goingLive } } : { ...inWeek, state: "draft" },
      { $set: { state: "published", "meta.publishedAt": now } },
      // Going live isn't an edit; keep updatedAt so the next publish only
      // messages people whose shifts really changed.
      { timestamps: false },
    );

    const [shifts, staff] = await Promise.all([
      Schedule.find({ ...inWeek, state: "published", status: { $ne: "call_out" } })
        .sort({ startTime: 1 })
        .lean(),
      User.find({ tenantId: req.tenantId, loginEnabled: false, status: "active" })
        .lean(),
    ]);
    const shiftsByStaff = new Map();
    for (const shift of shifts) {
      const key = String(shift.staffId);
      if (!shiftsByStaff.has(key)) shiftsByStaff.set(key, []);
      shiftsByStaff.get(key).push(shift);
    }

    // Fingerprint of a person's shifts; unchanged since their last message
    // (e.g. moved and moved back) means there's nothing to send them.
    const signatureOf = (key) => shiftSignature(shiftsByStaff.get(key) || []);
    const lastSent = week.sentSignatures || new Map();
    const hasSectionShift = (key) =>
      (shiftsByStaff.get(key) || []).some((shift) => inSection(shift, section));
    const recipients = staff.filter((person) => {
      const key = String(person._id);
      const hasShifts = shiftsByStaff.has(key);
      if (resendAll) return section ? hasSectionShift(key) : hasShifts || includeEveryone;
      if (firstPublish && !section) return hasShifts || includeEveryone;
      if (!changedStaffIds.has(key)) return false;
      return lastSent.get(key) !== signatureOf(key);
    });

    const prefsByStaff = new Map(
      (
        await Preferences.find({
          tenantId: req.tenantId,
          staffId: { $in: recipients.map((p) => p._id) },
        })
          .select("staffId emailNotificationsEnabled smsNotificationsEnabled")
          .lean()
      ).map((pref) => [String(pref.staffId), pref]),
    );

    const facility = req.tenant.name;
    const weekLabel = shortWeek(weekStart);
    const planKey = getEffectivePlanKey(req.tenant);
    const sent = { sms: 0, email: 0 };
    const notReached = [];

    for (const person of recipients) {
      const myShifts = shiftsByStaff.get(String(person._id)) || [];
      const lines = myShifts.map((shift) =>
        shortShift(shift.startTime, shift.endTime, settings.timezone),
      );
      const link = await linkForStaff(person);
      const summary = !lines.length
        ? "you're not on the schedule"
        : lines.length <= 4
          ? lines.join("; ")
          : `${lines.length} shifts`;
      // First message this week for them: "is ready"; otherwise an update.
      const isNew = !lastSent.has(String(person._id));
      const sms = `Hi ${firstName(person.name)}, your ${facility} schedule for ${weekLabel}${isNew ? "" : " was updated"}: ${summary}.${link ? ` ${link}` : ""}`;
      const html = `
        <p>Hi ${escapeHtml(firstName(person.name))},</p>
        <p>Your ${escapeHtml(facility)} schedule for <strong>${escapeHtml(weekLabel)}</strong>${isNew ? " is ready" : " was updated"}:</p>
        ${lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "<p>You're not on the schedule this week.</p>"}
        ${link ? `<p><a href="${link}">See your schedule, swap or pick up shifts</a></p>` : ""}`;

      const result = await sendToStaff({
        tenant: req.tenant,
        planKey,
        staff: person,
        kind: "week_published",
        sms,
        emailSubject: `Your ${facility} schedule for ${weekLabel}`,
        emailHtml: html,
        refId: week._id,
        preferences: prefsByStaff.get(String(person._id)) || null,
      });
      if (result.delivered) sent[result.channel] += 1;
      else notReached.push({ staffId: person._id, name: person.name, reason: result.reason });
    }

    for (const person of recipients) {
      week.sentSignatures.set(String(person._id), signatureOf(String(person._id)));
    }
    // Everyone messaged is up to date; anyone left (other sections) waits.
    if (section) {
      const messaged = new Set(recipients.map((person) => String(person._id)));
      week.pendingStaffIds = (week.pendingStaffIds || []).filter((id) => !messaged.has(String(id)));
    } else {
      week.pendingStaffIds = [];
    }
    // Once any part is out, the week counts as published; shifts in other
    // sections stay "Not sent yet" until someone sends them.
    week.status = "published";
    // Stamp after all writes above so nothing from this publish counts as
    // "changed since publish" next time.
    week.publishedAt = new Date();
    week.publishedBy = req.user._id;
    week.lastPublish = { sms: sent.sms, email: sent.email, notReached };
    await week.save();

    if (usedGraceWeek && req.tenant.graceWeekStart !== weekStart) {
      req.tenant.graceWeekStart = weekStart;
      await req.tenant.save();
    }

    res.json({
      usedGraceWeek,
      week: toWeekResponse(week),
      section: sectionResponse(section),
      firstPublish,
      messaged: recipients.length,
      sent,
      notReached,
    });
  } catch (err) {
    next(err);
  }
};

const MAX_RANGE_WEEKS = 8;

/**
 * GET /api/v1/weeks?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Opens every week touching the range (creating its open slots from the
 * template the first time) and returns one summary per week. Used by the
 * month and roster views so slots exist whatever view is opened.
 */
exports.getWeeksInRange = async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!isDateKey(from) || !isDateKey(to) || to < from) {
      return res
        .status(400)
        .json({ message: "from and to must be YYYY-MM-DD, in order" });
    }
    const settings = await getWeekSettings(req.tenantId);
    const weekStarts = [];
    let key = weekStartFor(
      new Date(`${from}T12:00:00Z`),
      "UTC",
      settings.weekStartsOn,
    );
    while (key <= to) {
      weekStarts.push(key);
      if (weekStarts.length > MAX_RANGE_WEEKS) {
        return res.status(400).json({
          message: `Ask for at most ${MAX_RANGE_WEEKS} weeks at a time`,
        });
      }
      key = addDaysToKey(key, 7);
    }

    const weeks = [];
    for (const weekStart of weekStarts) {
      const week = await ensureWeek({
        tenantId: req.tenantId,
        weekStart,
        settings,
      });
      const coverage = await Coverage.find({
        tenantId: req.tenantId,
        date: { $in: weekDays(weekStart).map(dateKeyToCoverageDate) },
      })
        .select("requiredCount")
        .lean();
      const assigned = await countAssignmentsByCoverage({
        tenantId: req.tenantId,
        coverageIds: coverage.map((row) => row._id),
      });
      const openSlots = coverage.reduce(
        (sum, row) =>
          sum + Math.max(0, row.requiredCount - (assigned.get(String(row._id)) || 0)),
        0,
      );
      weeks.push({ ...toWeekResponse(week), openSlots });
    }
    res.json({ weeks });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/weeks/:weekStart/slots
 * Body: { date: YYYY-MM-DD, shiftType, shiftTag, role, unitArea?,
 *         requiredCertificationTags?, count = 1 }
 * Adds a one-off need on one day (e.g. an extra caregiver Friday). If the
 * same slot already exists, its count goes up. Marked as hand-edited so
 * Weekly Needs changes leave it alone.
 */
exports.addSlot = async (req, res, next) => {
  try {
    const { weekStart } = req.params;
    const body = req.body || {};
    const settings = await getWeekSettings(req.tenantId);
    assertWeekStart(weekStart, settings.weekStartsOn);
    if (!weekDays(weekStart).includes(body.date)) {
      return res
        .status(400)
        .json({ message: "date must be a day in this week (YYYY-MM-DD)" });
    }
    const count = body.count === undefined ? 1 : Number(body.count);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return res.status(400).json({ message: "count must be 1–50" });
    }

    const prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId })
      .select("roleFamilies shiftTypeDefinitions unitAreas certificationTags")
      .lean();
    const norm = (v) => String(v || "").trim().toLowerCase();
    const role = norm(body.role);
    if (!(prefs?.roleFamilies || []).map(norm).includes(role)) {
      return res.status(400).json({ message: `Unknown role '${body.role}'` });
    }
    // Areas and certifications must exist in facility preferences.
    const unitArea = body.unitArea ? tagKey(body.unitArea) : null;
    if (unitArea && !(prefs?.unitAreas || []).map(tagKey).includes(unitArea)) {
      return res.status(400).json({ message: `Unknown unit area '${body.unitArea}'. Add it in Facility Preferences first.` });
    }
    const certs = Array.isArray(body.requiredCertificationTags)
      ? Array.from(new Set(body.requiredCertificationTags.map(tagKey).filter(Boolean)))
      : [];
    const knownCerts = (prefs?.certificationTags || []).map(tagKey);
    const unknownCert = certs.find((c) => !knownCerts.includes(c));
    if (unknownCert) {
      return res.status(400).json({ message: `Unknown certification '${unknownCert}'. Add it in Facility Preferences first.` });
    }

    await ensureWeek({ tenantId: req.tenantId, weekStart, settings });

    const weekday = new Date(`${body.date}T12:00:00Z`).getUTCDay();
    const countsByWeekday = [0, 0, 0, 0, 0, 0, 0];
    countsByWeekday[weekday] = count;
    const [op] = buildTemplateOps({
      tenantId: req.tenantId,
      rules: [
        {
          shiftType: norm(body.shiftType),
          shiftTag: norm(body.shiftTag),
          role,
          unitArea,
          requiredCertificationTags: certs,
          countsByWeekday,
        },
      ],
      dayKeys: [body.date],
      slotLookup: buildShiftSlotLookup(prefs),
      timezone: settings.timezone,
    });
    if (!op) {
      return res.status(400).json({
        message: `Unknown shift '${body.shiftType}:${body.shiftTag}'. Add it under shift times first.`,
      });
    }

    const existing = await Coverage.findOne(op.filter);
    let row;
    if (existing) {
      existing.requiredCount = Math.min(50, existing.requiredCount + count);
      existing.overridden = true;
      row = await existing.save();
    } else {
      row = await Coverage.create({
        ...op.filter,
        requiredCount: count,
        requiredCertificationTags: certs,
        source: "manual",
        overridden: true,
      });
    }
    res.status(existing ? 200 : 201).json({
      ...row.toObject(),
      dateKey: coverageDateToKey(row.date),
    });
  } catch (err) {
    if (err && err.statusCode) {
      return res
        .status(err.statusCode)
        .json({ message: err.message, errorCode: err.errorCode });
    }
    next(err);
  }
};

/**
 * Auto-fill a week: put the best available people on its open slots,
 * straight onto the schedule. In a draft week they're "Not sent yet" like
 * any other edit and go out when the week is published; in a published
 * week each person added gets a message.
 *
 * POST /api/v1/weeks/:weekStart/auto-fill   { coverageIds? }
 */
/**
 * Puts last week's people back on this week's Weekly Needs spots (same
 * weekday, shift, role and area), when they're still eligible, free and it
 * wouldn't mean overtime. New shifts are "Not sent yet". Returns their ids.
 */
async function keepLastWeeksPeople({ req, weekStart, settings, items }) {
  const templateItems = items.filter(({ row }) => row.source === "template" && row.shiftType);
  if (!templateItems.length) return [];

  const prevWeekStart = addDaysToKey(weekStart, -7);
  const prev = weekBounds(prevWeekStart, settings.timezone);
  const prevShifts = await Schedule.find({
    tenantId: req.tenantId,
    startTime: { $gte: prev.start, $lt: prev.end },
    state: { $ne: "draft" },
    status: { $in: ["scheduled", "in_progress", "completed"] },
  })
    .select("staffId role unitArea shiftType shiftTag startTime")
    .lean();
  if (!prevShifts.length) return [];

  const dayIndex = (instant, startKey) => {
    const local = DateTime.fromJSDate(new Date(instant)).setZone(settings.timezone).toISODate();
    return weekDays(startKey).indexOf(local);
  };
  const keyOf = (index, item) =>
    [index, tagKey(item.role), tagKey(item.unitArea), item.shiftType || "", item.shiftTag || ""].join("|");
  const lastWeek = new Map();
  for (const shift of prevShifts) {
    const key = keyOf(dayIndex(shift.startTime, prevWeekStart), shift);
    if (!lastWeek.has(key)) lastWeek.set(key, []);
    lastWeek.get(key).push(String(shift.staffId));
  }

  const prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId }).lean();
  const facilityConfig = getCompatibleFacilityConfig(prefs);
  const { start, end } = weekBounds(weekStart, settings.timezone);
  const overtimeThresholdMinutes = (prefs?.weeklyOvertimeThresholdHours || 40) * 60;
  const created = [];

  for (const { row, remaining } of templateItems) {
    const people = [...new Set(lastWeek.get(keyOf(dayIndex(row.startTime, weekStart), row)) || [])];
    if (!people.length) continue;
    // Checked per spot so earlier picks count (conflicts, weekly hours).
    const candidates = await eligibleStaffForCoverage({
      tenantId: req.tenantId,
      coverage: row,
      facilityConfig,
      weekStart: start,
      weekEnd: end,
      overtimeThresholdMinutes,
    });
    let left = remaining;
    for (const staffId of people) {
      if (left <= 0) break;
      const candidate = candidates.find(
        (c) => String(c.staff._id) === staffId && c.eligible && !c.overtimeIfAssigned,
      );
      if (!candidate) continue;
      const schedule = await Schedule.create({
        tenantId: req.tenantId,
        staffId,
        coverageId: row._id,
        role: row.role,
        unitArea: row.unitArea || null,
        shiftType: row.shiftType,
        shiftTag: row.shiftTag,
        certificationTags: row.requiredCertificationTags || [],
        startTime: row.startTime,
        endTime: row.endTime,
        timezone: settings.timezone,
        notes: "Auto-filled (same as last week)",
        status: "scheduled",
        state: "draft",
        meta: { createdBy: req.user._id, source: "auto" },
      });
      created.push(schedule._id);
      left -= 1;
    }
  }
  return created;
}

exports.autoFillWeek = async (req, res, next) => {
  try {
    const { weekStart } = req.params;
    if (!isDateKey(weekStart)) {
      return res.status(400).json({ message: "weekStart must be YYYY-MM-DD" });
    }
    const settings = await getWeekSettings(req.tenantId);
    const week = await ensureWeek({ tenantId: req.tenantId, weekStart, settings });
    const days = weekDays(weekStart);

    const filter = {
      tenantId: req.tenantId,
      date: { $in: days.map(dateKeyToCoverageDate) },
      endTime: { $gt: new Date() },
      requiredCount: { $gt: 0 },
    };
    if (Array.isArray(req.body?.coverageIds) && req.body.coverageIds.length) {
      filter._id = {
        $in: req.body.coverageIds.filter((id) => mongoose.isValidObjectId(id)),
      };
    }
    // Only some roles/areas ("Fill a section"); null = every open spot.
    const section = parseSection(req.body);
    const keepLastWeek = req.body?.keepLastWeek !== false;
    const coverage = (await Coverage.find(filter).sort({ startTime: 1 }).lean()).filter((row) =>
      inSection(row, section),
    );
    const openRows = async () => {
      const assigned = await countAssignmentsByCoverage({
        tenantId: req.tenantId,
        coverageIds: coverage.map((row) => row._id),
      });
      return coverage
        .map((row) => ({ row, remaining: row.requiredCount - (assigned.get(String(row._id)) || 0) }))
        .filter((item) => item.remaining > 0);
    };
    let openItems = await openRows();
    if (!openItems.length) {
      return res.json({ filled: 0, keptFromLastWeek: 0, stillOpen: 0, notified: 0, message: "Nothing open to fill." });
    }

    // 1) Keep last week's people: for Weekly Needs spots, whoever worked the
    // same shift, role and area on the same weekday last week gets it again
    // if they still can (eligible, free, no overtime).
    const keptIds = keepLastWeek
      ? await keepLastWeeksPeople({ req, weekStart, settings, items: openItems })
      : [];
    if (keptIds.length) openItems = await openRows();
    const open = openItems.map((item) => item.row);
    if (!open.length) {
      return res.json({
        filled: keptIds.length,
        keptFromLastWeek: keptIds.length,
        stillOpen: 0,
        notified: 0,
        weekStatus: week.status,
      });
    }

    // Reuse the auto-schedule ranking, then put its picks straight on the
    // schedule. The intermediate draft is removed afterwards.
    const scheduleController = require("./scheduleController");
    const AutoScheduleDraft = require("../models/autoScheduleDraftModel");
    const run = (handler, extra) =>
      new Promise((resolve, reject) => {
        const fakeRes = {
          statusCode: 200,
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(body) {
            resolve({ status: this.statusCode, body });
            return this;
          },
        };
        Promise.resolve(handler({ ...req, ...extra }, fakeRes, reject)).catch(reject);
      });

    // 2) Everything still open: the usual ranking (fairness, pattern, ...).
    const generated = await run(scheduleController.autoGenerateSchedule, {
      body: { coverageIds: open.map((row) => String(row._id)) },
    });
    if (generated.status >= 400) {
      return res.status(generated.status).json(generated.body);
    }
    const draftId = generated.body?.draftSchedule?.draftId;
    let scheduleIds = [];
    if (draftId && generated.body.generatedCount > 0) {
      const published = await run(scheduleController.publishAutoScheduleDraft, {
        params: { draftId: String(draftId) },
        body: {},
      });
      if (published.status >= 400 && published.status !== 409) {
        return res.status(published.status).json(published.body);
      }
      scheduleIds = published.body?.scheduleIds || [];
    }
    if (draftId) await AutoScheduleDraft.deleteOne({ _id: draftId, tenantId: req.tenantId });

    // In a published week too, filled slots wait as "Not sent yet" until
    // the scheduler presses Send.
    if (week.status === "published" && scheduleIds.length) {
      await Schedule.updateMany(
        { _id: { $in: scheduleIds }, tenantId: req.tenantId },
        { $set: { state: "draft" } },
      );
    }
    const notified = 0;

    const after = await countAssignmentsByCoverage({
      tenantId: req.tenantId,
      coverageIds: open.map((row) => row._id),
    });
    const stillOpen = open.reduce(
      (sum, row) => sum + Math.max(0, row.requiredCount - (after.get(String(row._id)) || 0)),
      0,
    );

    res.json({
      filled: scheduleIds.length + keptIds.length,
      keptFromLastWeek: keptIds.length,
      stillOpen,
      notified,
      weekStatus: week.status,
    });
  } catch (err) {
    next(err);
  }
};
