/**
 * Weeks
 * -----
 * ensureWeek: makes sure a ScheduleWeek exists and, the first time, creates
 * that week's Coverage rows from the StaffingTemplate. Safe to call again.
 *
 * syncTemplateToWeeks: after a template edit, updates the template rows of
 * upcoming weeks — except days the scheduler changed by hand.
 */
const { DateTime } = require("luxon");
const mongoose = require("mongoose");
const ScheduleWeek = require("../models/scheduleWeekModel");
const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const StaffingTemplate = require("../models/staffingTemplateModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const {
  isDateKey,
  dateKeyToCoverageDate,
  coverageDateToKey,
  weekdayOfKey,
  weekStartFor,
  weekDays,
  weekBounds,
  buildShiftSlotLookup,
  buildWindowFromShiftSlot,
  normalizeFacilityTimezone,
} = require("./dateUtils");
const { COVERAGE_OCCUPYING_STATUSES } = require("./scheduleUtils");

const weekError = (statusCode, errorCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.errorCode = errorCode;
  return err;
};

const getWeekSettings = async (tenantId) => {
  const prefs = await FacilityPreferences.findOne({ tenantId })
    .select("facilityTimezone weekStartsOn shiftTypeDefinitions")
    .lean();
  return {
    prefs,
    timezone: normalizeFacilityTimezone(prefs?.facilityTimezone),
    weekStartsOn: Number.isInteger(prefs?.weekStartsOn) ? prefs.weekStartsOn : 0,
  };
};

/** 400 unless `key` is YYYY-MM-DD on the facility's first day of the week. */
const assertWeekStart = (key, weekStartsOn) => {
  if (!isDateKey(key)) {
    throw weekError(400, "INVALID_WEEK_START", "weekStart must be YYYY-MM-DD");
  }
  if (weekdayOfKey(key) !== weekStartsOn) {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    throw weekError(
      400,
      "INVALID_WEEK_START",
      `Weeks start on ${names[weekStartsOn]}; ${key} is a ${names[weekdayOfKey(key)]}`,
    );
  }
};

/** Coverage upserts (template rows) for the given days. */
const buildTemplateOps = ({ tenantId, rules, dayKeys, slotLookup, timezone }) => {
  const ops = [];
  for (const dayKey of dayKeys) {
    const weekday = weekdayOfKey(dayKey);
    const date = dateKeyToCoverageDate(dayKey);
    for (const rule of rules) {
      const count = rule.countsByWeekday?.[weekday] || 0;
      if (count <= 0) continue;
      const window = buildWindowFromShiftSlot({
        date,
        shiftType: rule.shiftType,
        shiftTag: rule.shiftTag,
        slotLookup,
        facilityTimezone: timezone,
      });
      if (window.error) continue; // slot was deleted from settings; skip
      ops.push({
        rule,
        count,
        filter: {
          tenantId,
          date,
          role: rule.role,
          unitArea: rule.unitArea || null,
          shiftType: rule.shiftType,
          shiftTag: rule.shiftTag,
          startTime: window.startTime,
          endTime: window.endTime,
        },
      });
    }
  }
  return ops;
};

/**
 * Returns the ScheduleWeek for `weekStart` (YYYY-MM-DD), creating it and its
 * template coverage on first use.
 */
async function ensureWeek({ tenantId, weekStart, settings = null }) {
  const { prefs, timezone, weekStartsOn } =
    settings || (await getWeekSettings(tenantId));
  assertWeekStart(weekStart, weekStartsOn);

  const weekStartDate = dateKeyToCoverageDate(weekStart);
  let week = await ScheduleWeek.findOne({ tenantId, weekStart: weekStartDate });
  if (!week) {
    try {
      week = await ScheduleWeek.create({ tenantId, weekStart: weekStartDate });
    } catch (err) {
      if (err && err.code === 11000) {
        week = await ScheduleWeek.findOne({ tenantId, weekStart: weekStartDate });
      } else {
        throw err;
      }
    }
  }
  if (week.generatedAt) return week;

  const template = await StaffingTemplate.findOne({ tenantId }).lean();
  const ops = buildTemplateOps({
    tenantId,
    rules: template?.rules || [],
    dayKeys: weekDays(weekStart),
    slotLookup: buildShiftSlotLookup(prefs),
    timezone,
  });

  // Insert only rows that don't exist yet (never touch existing ones).
  if (ops.length) {
    // Two first loads at once can race on the unique index; the rows exist
    // either way, so duplicate-key errors are fine.
    await Coverage.bulkWrite(
      ops.map(({ rule, count, filter }) => ({
        updateOne: {
          filter,
          update: {
            $setOnInsert: {
              ...filter,
              requiredCount: count,
              requiredCertificationTags: rule.requiredCertificationTags || [],
              source: "template",
              templateRuleId: rule._id || null,
              overridden: false,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    ).catch((err) => {
      const isDuplicate =
        err?.code === 11000 ||
        (Array.isArray(err?.writeErrors) &&
          err.writeErrors.every((e) => (e.code || e.err?.code) === 11000));
      if (!isDuplicate) throw err;
    });
  }

  week.generatedAt = new Date();
  await week.save();
  return week;
}

/** Week start (YYYY-MM-DD) for an instant, in the facility's zone. */
async function weekStartForInstant(tenantId, instant, settings = null) {
  const { timezone, weekStartsOn } = settings || (await getWeekSettings(tenantId));
  return weekStartFor(instant, timezone, weekStartsOn);
}

/**
 * Remember that these people have unsent changes in the (published) week
 * containing `startTime`. Nothing is sent until the scheduler presses Send.
 */
async function markPendingChange({ tenantId, startTime, staffIds }) {
  const ids = (staffIds || []).filter(Boolean).map((id) => String(id._id || id));
  if (!ids.length || !startTime) return;
  const settings = await getWeekSettings(tenantId);
  const weekStart = weekStartFor(startTime, settings.timezone, settings.weekStartsOn);
  await ScheduleWeek.updateOne(
    { tenantId, weekStart: dateKeyToCoverageDate(weekStart), status: "published" },
    { $addToSet: { pendingStaffIds: { $each: ids.map((id) => new mongoose.Types.ObjectId(id)) } } },
  );
}

/** "draft" | "published" for a new Schedule starting at `startTime`. */
async function stateForNewSchedule({ tenantId, startTime }) {
  const settings = await getWeekSettings(tenantId);
  const weekStart = weekStartFor(startTime, settings.timezone, settings.weekStartsOn);
  const week = await ensureWeek({ tenantId, weekStart, settings });
  return week.status === "published" ? "published" : "draft";
}

/**
 * Re-applies the template to generated weeks from the current week on.
 * applyTo: "unpublished" (draft weeks only) | "all_future"
 * Rows the scheduler changed by hand (overridden) are left alone.
 */
async function syncTemplateToWeeks({ tenantId, applyTo = "unpublished" }) {
  const settings = await getWeekSettings(tenantId);
  const currentWeekStart = weekStartFor(new Date(), settings.timezone, settings.weekStartsOn);
  const weekFilter = {
    tenantId,
    generatedAt: { $ne: null },
    weekStart: { $gte: dateKeyToCoverageDate(currentWeekStart) },
  };
  if (applyTo !== "all_future") weekFilter.status = "draft";

  const [weeks, template] = await Promise.all([
    ScheduleWeek.find(weekFilter).lean(),
    StaffingTemplate.findOne({ tenantId }).lean(),
  ]);
  if (!weeks.length) return { weeksUpdated: 0 };

  const slotLookup = buildShiftSlotLookup(settings.prefs);
  const rules = template?.rules || [];
  const today = DateTime.now().setZone(settings.timezone).toISODate();

  for (const week of weeks) {
    const startKey = coverageDateToKey(week.weekStart);
    // Never rewrite days that have already started.
    const dayKeys = weekDays(startKey).filter((key) => key >= today);
    if (!dayKeys.length) continue;

    const ops = buildTemplateOps({
      tenantId,
      rules,
      dayKeys,
      slotLookup,
      timezone: settings.timezone,
    });
    const wanted = new Map(
      ops.map((op) => [
        [op.filter.date.toISOString(), op.filter.role, op.filter.unitArea || "", op.filter.shiftType, op.filter.shiftTag, op.filter.startTime.toISOString()].join("|"),
        op,
      ]),
    );

    const existing = await Coverage.find({
      tenantId,
      source: "template",
      date: { $in: dayKeys.map(dateKeyToCoverageDate) },
    });

    for (const row of existing) {
      const key = [row.date.toISOString(), row.role, row.unitArea || "", row.shiftType, row.shiftTag, row.startTime.toISOString()].join("|");
      const op = wanted.get(key);
      wanted.delete(key);
      if (row.overridden) continue;

      if (op) {
        const certs = op.rule.requiredCertificationTags || [];
        const certsChanged =
          certs.length !== (row.requiredCertificationTags || []).length ||
          certs.some((tag, i) => tag !== row.requiredCertificationTags[i]);
        if (row.requiredCount !== op.count || certsChanged) {
          row.requiredCount = op.count;
          row.requiredCertificationTags = certs;
          await row.save();
        }
        continue;
      }
      // Rule (or this day) was removed from the template.
      const assigned = await Schedule.countDocuments({
        tenantId,
        coverageId: row._id,
        status: { $in: COVERAGE_OCCUPYING_STATUSES },
      });
      if (assigned) {
        row.requiredCount = 0;
        await row.save();
      } else {
        await Coverage.deleteOne({ _id: row._id });
      }
    }

    // New rules / days.
    for (const { rule, count, filter } of wanted.values()) {
      await Coverage.updateOne(
        filter,
        {
          $setOnInsert: {
            ...filter,
            requiredCount: count,
            requiredCertificationTags: rule.requiredCertificationTags || [],
            source: "template",
            templateRuleId: rule._id || null,
            overridden: false,
          },
        },
        { upsert: true },
      );
    }
  }

  return { weeksUpdated: weeks.length };
}

module.exports = {
  markPendingChange,
  buildTemplateOps,
  getWeekSettings,
  assertWeekStart,
  ensureWeek,
  weekStartForInstant,
  stateForNewSchedule,
  syncTemplateToWeeks,
  weekBounds,
};
