/**
 * One-time cleanup: duplicate / leftover open spots from the old Coverage
 * Planning screen.
 *
 * The old screen saved needs with custom times and no shift name, and areas
 * as "assisted living". Weekly Needs saves named shifts ("Day 7a–3p") and
 * areas as "assisted_living". The two never matched, so the same spot could
 * show twice on the schedule ("Shift 7a–3p" and "Day 7a–3p").
 *
 * For spots that haven't started yet:
 *   1. Rows that are the same spot (same day, role, area and hours, where a
 *      nameless row's hours equal one of the facility's shift times) are
 *      merged into one: the Weekly Needs row is kept, people on the others
 *      are moved onto it, the others are deleted.
 *   2. A nameless row whose hours are one of the shift times, with nobody
 *      to merge into, gets that shift name (so it shows as "Day 7a–3p").
 *   3. A nameless row with nobody on it and hours that aren't a shift time
 *      is deleted (old Coverage Planning leftover).
 *   4. A nameless row with people on it and hours that aren't a shift time
 *      (e.g. 9a–5p) is kept and listed, for the scheduler to decide.
 * Areas on kept rows are rewritten to the Weekly Needs form.
 *
 * "Upcoming" means from now on. --from=YYYY-MM-DD moves the start back to the
 * start of that day (facility time), e.g. --from=2026-10-11 to also tidy the
 * days of this week that have already happened. Those get the same merge
 * treatment: people are moved, no shifts are deleted.
 *
 * Spots before that are left alone unless you pass --include-past. Then nameless
 * past rows are deleted together with their shifts (and those shifts' swap
 * requests). Rows whose shifts have clock-in records are skipped so hours
 * history stays intact.
 *
 * Usage:
 *   node scripts/cleanup-duplicate-coverage.js                       # dry run, all facilities
 *   node scripts/cleanup-duplicate-coverage.js --tenant=<tenantId>   # dry run, one facility
 *   node scripts/cleanup-duplicate-coverage.js --tenant=<id> --apply # make the changes
 *   add --from=2026-10-11 to also tidy this week's earlier days (merge only)
 *   add --include-past to also remove older nameless rows and their shifts
 * Reads DB_URL from config.env / the environment. Safe to run again.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "config.env") });
const mongoose = require("mongoose");
const { DateTime } = require("luxon");
const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");
const ShiftSwap = require("../models/shiftSwapModel");
const TimeEntry = require("../models/timeEntryModel");
const Tenant = require("../models/tenantModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const { tagKey } = require("../utils/tagKey");
const {
  buildShiftSlotLookup,
  findShiftSlotForWindow,
  normalizeFacilityTimezone,
  coverageDateToKey,
} = require("../utils/dateUtils");
const { COVERAGE_OCCUPYING_STATUSES } = require("../utils/scheduleUtils");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const INCLUDE_PAST = args.includes("--include-past");
const TENANT = (args.find((a) => a.startsWith("--tenant=")) || "").split("=")[1] || null;
const FROM = (args.find((a) => a.startsWith("--from=")) || "").split("=")[1] || null;
if (FROM && !/^\d{4}-\d{2}-\d{2}$/.test(FROM)) {
  console.error("--from must be YYYY-MM-DD");
  process.exit(1);
}

const hhmm = (d, tz) =>
  new Date(d).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
const describe = (row, tz) =>
  `${coverageDateToKey(row.date)} ${hhmm(row.startTime, tz)}–${hhmm(row.endTime, tz)} ${row.role}` +
  `${row.unitArea ? ` / ${row.unitArea}` : ""}${row.shiftType ? ` [${row.shiftType}]` : " [no shift name]"}`;

// Prefer the Weekly Needs row, then any named row, then the oldest.
const keeperRank = (row) => (row.source === "template" ? 0 : row.shiftType ? 1 : 2);

async function cleanTenant(tenantId) {
  const prefs = await FacilityPreferences.findOne({ tenantId }).lean();
  const tz = normalizeFacilityTimezone(prefs?.facilityTimezone);
  const slotLookup = buildShiftSlotLookup(prefs);
  // Where "upcoming" starts: now, or the start of --from day in facility time.
  const now = FROM ? DateTime.fromISO(FROM, { zone: tz }).startOf("day").toJSDate() : new Date();
  const stats = { merged: 0, moved: 0, named: 0, deletedEmpty: 0, keptCustom: 0, renamedArea: 0, pastDeleted: 0, pastShifts: 0, pastSkipped: 0 };
  const log = [];

  const upcoming = await Coverage.find({ tenantId, startTime: { $gte: now } }).sort({ createdAt: 1 }).lean();
  const ids = upcoming.map((r) => r._id);
  const schedules = ids.length
    ? await Schedule.find({ tenantId, coverageId: { $in: ids } }).select("_id coverageId status").lean()
    : [];
  const byRow = new Map();
  for (const s of schedules) {
    const k = String(s.coverageId);
    if (!byRow.has(k)) byRow.set(k, []);
    byRow.get(k).push(s);
  }

  // Group rows that are the same spot.
  const groups = new Map();
  for (const row of upcoming) {
    const named = row.shiftType
      ? { shiftType: row.shiftType, shiftTag: row.shiftTag }
      : findShiftSlotForWindow({ date: row.date, startTime: row.startTime, endTime: row.endTime, slotLookup, facilityTimezone: tz });
    const key = [
      coverageDateToKey(row.date),
      tagKey(row.role),
      tagKey(row.unitArea),
      new Date(row.startTime).toISOString(),
      new Date(row.endTime).toISOString(),
      named ? `${named.shiftType}:${named.shiftTag}` : "custom",
    ].join("|");
    if (!groups.has(key)) groups.set(key, { named, rows: [] });
    groups.get(key).rows.push(row);
  }

  for (const { named, rows } of groups.values()) {
    rows.sort((a, b) => keeperRank(a) - keeperRank(b));
    let [keep, ...others] = rows;

    // 1. Merge duplicates into the keeper.
    for (const other of others) {
      const people = byRow.get(String(other._id)) || [];
      log.push(`merge   ${describe(other, tz)} -> ${describe(keep, tz)} (${people.length} shift(s) moved)`);
      stats.merged += 1;
      stats.moved += people.length;
      if (APPLY) {
        if (people.length) {
          await Schedule.updateMany(
            { _id: { $in: people.map((p) => p._id) } },
            { $set: { coverageId: keep._id, shiftType: named?.shiftType || keep.shiftType || null, shiftTag: named?.shiftTag || keep.shiftTag || null } },
          );
        }
        // If the other row asked for more people than the keeper, keep the larger need.
        if ((other.requiredCount || 0) > (keep.requiredCount || 0) && keep.source !== "template") {
          await Coverage.updateOne({ _id: keep._id }, { $set: { requiredCount: other.requiredCount } });
        }
        await Coverage.deleteOne({ _id: other._id });
      }
      byRow.set(String(keep._id), [...(byRow.get(String(keep._id)) || []), ...people]);
    }

    const people = byRow.get(String(keep._id)) || [];
    const update = {};

    if (!keep.shiftType) {
      if (named) {
        // 2. Give it the shift name.
        update.shiftType = named.shiftType;
        update.shiftTag = named.shiftTag;
        log.push(`name    ${describe(keep, tz)} -> ${named.shiftType}`);
        stats.named += 1;
      } else if (!people.length) {
        // 3. Empty leftover with custom hours.
        log.push(`delete  ${describe(keep, tz)} (nobody on it)`);
        stats.deletedEmpty += 1;
        if (APPLY) await Coverage.deleteOne({ _id: keep._id });
        continue;
      } else {
        // 4. People on custom hours: keep for the scheduler.
        log.push(`keep    ${describe(keep, tz)} (${people.length} shift(s), hours aren't a shift time)`);
        stats.keptCustom += 1;
      }
    }

    if (keep.unitArea && keep.unitArea !== tagKey(keep.unitArea)) {
      update.unitArea = tagKey(keep.unitArea);
      stats.renamedArea += 1;
    }
    if (APPLY && Object.keys(update).length) {
      await Coverage.updateOne({ _id: keep._id }, { $set: update });
      if (update.shiftType && people.length) {
        await Schedule.updateMany(
          { _id: { $in: people.map((p) => p._id) } },
          { $set: { shiftType: update.shiftType, shiftTag: update.shiftTag } },
        );
      }
    }
  }

  // Past nameless rows (only with --include-past).
  if (INCLUDE_PAST) {
    const past = await Coverage.find({ tenantId, startTime: { $lt: now }, shiftType: null }).lean();
    for (const row of past) {
      const shifts = await Schedule.find({ tenantId, coverageId: row._id }).select("_id").lean();
      const shiftIds = shifts.map((s) => s._id);
      const clocked = shiftIds.length ? await TimeEntry.countDocuments({ tenantId, scheduleId: { $in: shiftIds } }) : 0;
      if (clocked) {
        log.push(`skip    ${describe(row, tz)} (has clock-in records)`);
        stats.pastSkipped += 1;
        continue;
      }
      log.push(`past    ${describe(row, tz)} (delete with ${shiftIds.length} shift(s))`);
      stats.pastDeleted += 1;
      stats.pastShifts += shiftIds.length;
      if (APPLY) {
        if (shiftIds.length) {
          await ShiftSwap.deleteMany({ tenantId, scheduleId: { $in: shiftIds } });
          await Schedule.deleteMany({ _id: { $in: shiftIds } });
        }
        await Coverage.deleteOne({ _id: row._id });
      }
    }
  }

  return { stats, log };
}

async function main() {
  const url = process.env.DB_URL || process.env.MONGO_URI;
  if (!url) throw new Error("Set DB_URL (config.env or environment)");
  await mongoose.connect(url);

  const tenants = TENANT
    ? [{ _id: new mongoose.Types.ObjectId(TENANT), name: "(selected)" }]
    : await Tenant.find({}).select("_id name").lean();

  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN (nothing is changed; add --apply)"}` +
      `${FROM ? `, from ${FROM}` : ", from now"}${INCLUDE_PAST ? ", including older rows" : ""}\n`,
  );
  const total = {};
  for (const t of tenants) {
    const { stats, log } = await cleanTenant(t._id);
    if (!log.length && !stats.renamedArea) continue;
    console.log(`== ${t.name} (${t._id})`);
    log.forEach((line) => console.log(`  ${line}`));
    console.log(`  ${JSON.stringify(stats)}\n`);
    for (const [k, v] of Object.entries(stats)) total[k] = (total[k] || 0) + v;
  }
  console.log("Total:", JSON.stringify(total));
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
