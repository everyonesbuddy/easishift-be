const test = require("node:test");
const assert = require("node:assert/strict");
const workweek = require("../utils/workweek");
const { buildLaborReport } = require("../utils/laborReport");

const ww = workweek.settingsFrom({ facilityTimezone: "UTC", weekStartsOn: 0, roleWeekStarts: [{ roles: ["Cook", "server"], weekStartsOn: 4 }] }, "UTC");

test("workweeks: roles in a group get its day, everyone else the building's", () => {
  assert.equal(workweek.weekdayFor({ roles: ["cook"] }, ww), 4);
  assert.equal(workweek.weekdayFor({ role: "server" }, ww), 4, "role or roles");
  assert.equal(workweek.weekdayFor({ roles: ["cna"] }, ww), 0);
  assert.equal(workweek.weekdayFor({ roles: [] }, ww), 0);
  // Sat 2026-11-14 falls in the cook's week that started Thu 11-12, and the CNA's that started Sun 11-08.
  assert.equal(workweek.weekRangeFor({ roles: ["cook"] }, new Date("2026-11-14T12:00:00Z"), ww).key, "2026-11-12");
  assert.equal(workweek.weekRangeFor({ roles: ["cna"] }, new Date("2026-11-14T12:00:00Z"), ww).key, "2026-11-08");
});

test("workweeks: groups are cleaned (lowercase, bad days dropped, a role only in its first group)", () => {
  assert.deepEqual(
    workweek.cleanRoleWeekStarts([
      { roles: ["Cook", " server "], weekStartsOn: 4 },
      { roles: ["cook", "dietary"], weekStartsOn: 5 },
      { roles: ["x"], weekStartsOn: 9 },
      { roles: [], weekStartsOn: 2 },
    ]),
    [
      { roles: ["cook", "server"], weekStartsOn: 4 },
      { roles: ["dietary"], weekStartsOn: 5 },
    ],
  );
  assert.equal(workweek.hasRoleWeeks(workweek.settingsFrom({}, "UTC")), false);
});

test("labor report: a cook's overtime counts over their own Thursday week", () => {
  // Building week Mon 2026-10-19 .. Sun 10-25. The cook works 12h Thu, Fri, Sat (the week before)
  // and Mon, Tue: 24h in the building's week, but 60h in their Thursday-to-Wednesday week.
  const DAYS = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
  let n = 0;
  const shift = (day) => ({ _id: `s${++n}`, staffId: "kim", role: "cook", shiftType: "day", startTime: new Date(`${day}T07:00:00Z`), endTime: new Date(`${day}T19:00:00Z`), status: "scheduled" });
  const schedules = ["2026-10-15", "2026-10-16", "2026-10-17", "2026-10-19", "2026-10-20"].map(shift);
  const args = { weekStart: DAYS[0], days: DAYS, timezone: "UTC", thresholdHours: 40, staff: [{ _id: "kim", name: "Kim Tran", roles: ["cook"], status: "active" }], now: new Date("2026-10-21T12:00:00Z"), shiftLabel: (t) => t, schedules, timeEntries: [] };
  assert.equal(buildLaborReport({ ...args, weekStarts: ["2026-10-19"] }).overtime.people.length, 0, "the building's week alone sees no overtime");
  const r = buildLaborReport({ ...args, weekStarts: ["2026-10-19"], weekdayOf: () => 4 });
  assert.equal(r.overtime.people.length, 1);
  assert.equal(r.overtime.people[0].overtimeHours, 20, "8h on Monday and 12h on Tuesday");
  assert.equal(r.overtime.people[0].crossesOn, "2026-10-19");
});

test("eligibility: each person's hours are summed over their own week", async () => {
  const Schedule = require("../models/scheduleModel");
  const TimeOff = require("../models/timeOffModel");
  const { eligibleStaffForCoverage, getCompatibleFacilityConfig } = require("../utils/eligibility");
  const chain = (rows) => ({ select: () => ({ lean: async () => rows }), lean: async () => rows });
  const at = (d) => new Date(`${d}T07:00:00Z`);
  const twelve = (staffId, d) => ({ staffId, startTime: at(d), endTime: new Date(at(d).getTime() + 12 * 3600e3) });
  // Coverage on Sat 11-14. Cook's week: Thu 11-12 .. Wed 11-18. CNA's: Sun 11-08 .. Sat 11-14.
  const rows = [twelve("cook1", "2026-11-09"), twelve("cook1", "2026-11-12"), twelve("cook1", "2026-11-13"), twelve("cna1", "2026-11-09"), twelve("cna1", "2026-11-12"), twelve("cna1", "2026-11-13")];
  const orig = [Schedule.find, TimeOff.find];
  let asked = null;
  Schedule.find = (q) => {
    if (q.startTime?.$gte) {
      asked = q.startTime;
      return chain(rows.filter((r) => r.startTime >= q.startTime.$gte && r.startTime < q.startTime.$lt));
    }
    return chain([]);
  };
  TimeOff.find = () => chain([]);
  try {
    const prefs = { facilityTimezone: "UTC", weekStartsOn: 0, roleFamilies: ["cna", "cook"], roleWeekStarts: [{ roles: ["cook"], weekStartsOn: 4 }] };
    const out = await eligibleStaffForCoverage({
      tenantId: "t",
      coverage: { _id: "c1", role: "cook", startTime: new Date("2026-11-14T07:00:00Z"), endTime: new Date("2026-11-14T19:00:00Z") },
      facilityConfig: getCompatibleFacilityConfig(prefs),
      weekStart: new Date("2026-11-08T00:00:00Z"),
      weekEnd: new Date("2026-11-15T00:00:00Z"),
      overtimeThresholdMinutes: 40 * 60,
      staffList: [{ _id: "cook1", name: "Cook", roles: ["cook"] }, { _id: "cna1", name: "CNA", roles: ["cna"] }],
    });
    const by = Object.fromEntries(out.map((r) => [String(r.staff._id), r]));
    assert.equal(by.cook1.weekMinutes, 24 * 60, "Mon 11-09 is the cook's previous week");
    assert.equal(by.cook1.overtimeIfAssigned, false);
    assert.equal(by.cna1.weekMinutes, 36 * 60);
    assert.equal(by.cna1.overtimeIfAssigned, true);
    assert.equal(asked.$gte.toISOString(), "2026-11-08T00:00:00.000Z", "one query covering both weeks");
    assert.equal(asked.$lt.toISOString(), "2026-11-19T00:00:00.000Z");
  } finally {
    [Schedule.find, TimeOff.find] = orig;
  }
});

test("settings: schedulers can change role workweeks; every change is recorded and emailed", async () => {
  const FacilityPreferences = require("../models/facilityPreferencesModel");
  const ScheduleWeek = require("../models/scheduleWeekModel");
  const ctrl = require("../controllers/facilityPreferencesController");
  const current = { weekStartsOn: 0, roleWeekStarts: [{ roles: ["cook"], weekStartsOn: 0 }] };
  const orig = [FacilityPreferences.findOne, FacilityPreferences.findOneAndUpdate, ScheduleWeek.countDocuments, workweek.notifyWorkweekChange];
  let update = null;
  let emailed = null;
  FacilityPreferences.findOne = () => ({ select: () => ({ lean: async () => current }), lean: async () => current });
  FacilityPreferences.findOneAndUpdate = async (f, u) => ((update = u), {});
  ScheduleWeek.countDocuments = async () => 3;
  workweek.notifyWorkweekChange = async (args) => (emailed = args);
  const run = async (user, body) => {
    const out = {};
    update = null;
    emailed = null;
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; out.status ??= 200; return this; } };
    await ctrl.upsertFacilityPreferences({ tenantId: "t", user, body, plan: { key: "growth" } }, res, (e) => { out.error = e; });
    return out;
  };
  const william = { _id: "u-william", name: "William Smith", role: "scheduler", roles: [] };
  const owner = { _id: "u-owner", name: "Melanie Hendrix", role: "owner", roles: [] };
  try {
    // The page sends everything back unchanged: nothing recorded, nobody emailed.
    const same = await run(william, { weekStartsOn: 0, roleWeekStarts: [{ roles: ["Cook"], weekStartsOn: 0 }], shiftReminderLeadHours: 12 });
    assert.equal(same.status, 200);
    assert.equal(update.$push, undefined);
    assert.equal(emailed, null);

    // William moves dining to Thursday: saved, recorded with his name, owner and admins emailed (not him).
    const moved = await run(william, { roleWeekStarts: [{ roles: ["cook", "server"], weekStartsOn: 4 }] });
    assert.equal(moved.status, 200);
    const entry = update.$push.roleWeekStartsHistory.$each[0];
    assert.equal(entry.byName, "William Smith");
    assert.deepEqual(entry.from, [{ roles: ["cook"], weekStartsOn: 0 }]);
    assert.deepEqual(entry.to, [{ roles: ["cook", "server"], weekStartsOn: 4 }]);
    assert.equal(update.$push.roleWeekStartsHistory.$slice, -50);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(emailed.excludeUserIds, ["u-william"]);
    assert.equal(workweek.describe(entry.to), "Cook, Server: Thursday to Wednesday");

    // The page can't write the history itself.
    await run(owner, { roleWeekStartsHistory: [{ byName: "fake" }] });
    assert.equal(update.$set.roleWeekStartsHistory, undefined);

    // Duplicates are caught.
    assert.equal((await run(owner, { roleWeekStarts: [{ roles: ["cook"], weekStartsOn: 4 }, { roles: ["Cook"], weekStartsOn: 5 }] })).status, 400);
    // The building's week: owner or admin only, and locked once weeks are published.
    assert.equal((await run(william, { weekStartsOn: 5 })).status, 403);
    const locked = await run(owner, { weekStartsOn: 5 });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.errorCode, "WEEK_START_LOCKED");
  } finally {
    [FacilityPreferences.findOne, FacilityPreferences.findOneAndUpdate, ScheduleWeek.countDocuments, workweek.notifyWorkweekChange] = orig;
  }
});

test("workweeks: role names match however they're written", () => {
  const w = workweek.settingsFrom({ weekStartsOn: 0, roleWeekStarts: [{ roles: ["med_tech"], weekStartsOn: 4 }] }, "UTC");
  assert.equal(workweek.weekdayFor({ roles: ["Med Tech"] }, w), 4);
  assert.equal(workweek.weekdayFor({ roles: ["med-tech"] }, w), 4);
});
