const test = require("node:test");
const assert = require("node:assert/strict");
const { buildLaborReport } = require("../utils/laborReport");
const { buildLaborEmail } = require("../utils/laborReportJobs");
const { _normalizeStaffInput: normalize } = require("../controllers/staffController");
const { SYSTEM_ROLE_PERMISSIONS } = require("../config/authorization");
const { hasFeature } = require("../config/plans");

// Week Mon 2026-10-19 .. Sun 2026-10-25, UTC for easy math.
const DAYS = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];
const at = (day, hour) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
let n = 0;
const shift = (staffId, day, startHour, hours, extra = {}) => ({
  _id: `s${++n}`,
  staffId,
  role: "cna",
  shiftType: "day",
  shiftTag: "day_8h",
  startTime: at(day, startHour),
  endTime: new Date(at(day, startHour).getTime() + hours * 3600e3),
  status: "scheduled",
  ...extra,
});
const STAFF = [
  { _id: "maria", name: "Maria Lopez", roles: ["cna"], status: "active", certificationTags: ["cpr", "dementia"],
    credentials: [{ tag: "cpr", expiresAt: new Date("2026-10-10") }, { tag: "dementia", expiresAt: new Date("2026-11-05") }] },
  { _id: "jo", name: "Jo Bell", roles: ["nurse"], status: "active", certificationTags: ["cpr"],
    credentials: [{ tag: "cpr", expiresAt: new Date("2027-06-01") }] },
  { _id: "kim", name: "Kim Tran", roles: ["cna"], status: "active", certificationTags: [], credentials: [] },
];
const NOW = new Date("2026-10-21T12:00:00Z"); // Wednesday noon
const base = (over = {}) => buildLaborReport({
  weekStart: DAYS[0], days: DAYS, timezone: "UTC", thresholdHours: 40,
  staff: STAFF, now: NOW, shiftLabel: (t) => (t === "day" ? "Day 7a–3p" : t), ...over,
});

test("hours scheduled vs worked; call-outs and no-shows don't count as staffed hours", () => {
  const r = base({
    schedules: [
      shift("maria", DAYS[0], 7, 8),
      shift("jo", DAYS[0], 7, 8, { role: "nurse" }),
      shift("kim", DAYS[1], 7, 8, { status: "call_out" }),
      shift("kim", DAYS[2], 7, 8, { status: "no_show" }),
    ],
    timeEntries: [{ staffId: "maria", scheduleId: "s1", clockInAt: at(DAYS[0], 7), clockOutAt: at(DAYS[0], 15), totals: { workedMinutes: 450 } }],
  });
  assert.equal(r.hours.scheduled, 16);
  assert.equal(r.hours.worked, 7.5);
  assert.deepEqual(r.hours.byRole.map((x) => [x.role, x.scheduled]), [["cna", 8], ["nurse", 8]]);
  assert.equal(r.attendance.callOuts, 1);
  assert.equal(r.attendance.noShows, 1);
  assert.equal(r.attendance.byShift[0].label, "Day 7a–3p");
});

test("overtime coming: who goes over, by how much, and on which day", () => {
  // Maria: 12h Mon-Fri = 60h, crosses 40 on Thursday (36 by Wed, 48 Thu).
  const schedules = DAYS.slice(0, 5).map((d) => shift("maria", d, 7, 12));
  const r = base({ schedules });
  assert.equal(r.overtime.people.length, 1);
  const o = r.overtime.people[0];
  assert.equal(o.name, "Maria Lopez");
  assert.equal(o.projectedHours, 60);
  assert.equal(o.overtimeHours, 20);
  assert.equal(o.crossesOn, "2026-10-22");
  assert.equal(o.alreadyOver, false);
  assert.equal(r.overtime.totalOvertimeHours, 20);
});

test("budget: hours per resident day against target (daily counts, else the usual number)", () => {
  const schedules = DAYS.map((d) => shift("maria", d, 7, 10)); // 70h
  const r = base({
    schedules,
    settings: { typicalCensus: 10, budgetHoursPerResidentDay: 0.9, census: [{ date: DAYS[0], residents: 20 }] },
  });
  // resident days = 20 + 6*10 = 80; 70h / 80 = 0.88; budget 72h -> -2h
  assert.equal(r.budget.residentDays, 80);
  assert.equal(r.budget.scheduledPPD, 0.88);
  assert.equal(r.budget.budgetHours, 72);
  assert.equal(r.budget.varianceHours, -2);
  assert.equal(r.budget.censusSource, "mixed");
  assert.equal(base({ schedules }).budget, null, "no residents known = no budget section");
});

test("costs only when asked for; overtime premium; per-person rate beats role rate; missing rates listed", () => {
  const schedules = [
    ...DAYS.slice(0, 5).map((d) => shift("maria", d, 7, 10)), // 50h, 10h OT
    shift("jo", DAYS[0], 7, 8, { role: "nurse" }),
  ];
  const settings = { payRates: [{ role: "cna", hourlyRate: 20 }], staffRates: [{ staffId: "maria", hourlyRate: 22 }], overtimeMultiplier: 1.5 };
  assert.equal(base({ schedules, settings }).costs, null);
  const c = base({ schedules, settings, includeCosts: true }).costs;
  // base 50*22 = 1100, premium 10*22*0.5 = 110; nurse has no rate
  assert.equal(c.scheduled, 1210);
  assert.equal(c.overtimePremium, 110);
  assert.deepEqual(c.missingRates, ["nurse"]);
  assert.equal(base({ schedules, includeCosts: true }).costs.needsRates, true);
});

test("open shifts: filled, missed (ended unfilled) and still open", () => {
  const r = base({
    coverage: [
      { requiredCount: 3, assignedCount: 2, endTime: at(DAYS[0], 15) }, // past, 1 missed
      { requiredCount: 2, assignedCount: 0, endTime: at(DAYS[4], 15) }, // upcoming, 2 open
      { requiredCount: 1, assignedCount: 3, endTime: at(DAYS[1], 15) }, // over-filled counts as 1
    ],
  });
  assert.deepEqual(r.openShifts, { required: 6, filled: 3, unfilledPast: 1, openUpcoming: 2 });
});

test("credentials: expired and expiring in 30 days; dropped certifications ignored", () => {
  const r = base({});
  assert.deepEqual(r.credentials.expired.map((c) => [c.name, c.tag]), [["Maria Lopez", "cpr"]]);
  assert.deepEqual(r.credentials.expiringSoon.map((c) => [c.name, c.tag, c.daysLeft]), [["Maria Lopez", "dementia", 15]]);
  const dropped = base({ staff: [{ ...STAFF[0], certificationTags: ["dementia"] }] });
  assert.equal(dropped.credentials.expired.length, 0);
});

test("turnover watch: repeated call-outs, overtime weeks, hours falling off", () => {
  const weekEnd = new Date("2026-10-26T00:00:00Z");
  const daysAgo = (d, h = 7) => new Date(weekEnd.getTime() - d * 86400e3 + h * 3600e3);
  const s = (id, start, hours, status = "scheduled") => ({ _id: `t${++n}`, staffId: id, role: "cna", startTime: start, endTime: new Date(start.getTime() + hours * 3600e3), status });
  const schedules = [
    // Kim: 2 call-outs recently
    s("kim", daysAgo(20), 8, "call_out"), s("kim", daysAgo(12), 8, "call_out"),
    // Jo: 40h/week before, ~8h/week lately
    ...[30, 33, 36, 40, 44, 47, 50, 53].map((d) => s("jo", daysAgo(d), 12)),
    s("jo", daysAgo(10), 8),
  ];
  const r = base({ schedules, now: new Date("2026-10-25T20:00:00Z") });
  const byName = Object.fromEntries(r.turnoverWatch.map((w) => [w.name, w.reasons]));
  assert.match(byName["Kim Tran"][0], /2 call-outs/);
  assert.match(byName["Jo Bell"][0], /hours down/);
  assert.equal(byName["Maria Lopez"], undefined);
});

test("credential expiry dates on staff: kept only for certifications they have", () => {
  const { value } = normalize(
    { name: "A", roles: ["cna"], certificationTags: ["CPR"], credentials: [{ tag: "cpr", expiresAt: "2027-01-31" }, { tag: "dementia", expiresAt: "2027-01-31" }, { tag: "cpr", expiresAt: "" }] },
    new Set(["cna"]),
  );
  assert.deepEqual(value.credentials.map((c) => c.tag), ["cpr"]);
  assert.equal(normalize({ name: "A", roles: ["cna"], certificationTags: ["cpr"], credentials: [{ tag: "cpr", expiresAt: "soon" }] }, new Set(["cna"])).error, "Invalid expiry date for 'cpr'");
  // Removing a certification in an update drops its date.
  const existing = { certificationTags: ["cpr", "dementia"], credentials: [{ tag: "cpr", expiresAt: new Date() }, { tag: "dementia", expiresAt: new Date() }] };
  const upd = normalize({ certificationTags: ["dementia"] }, new Set(["cna"]), { partial: true, existing });
  assert.deepEqual(upd.value.credentials.map((c) => c.tag), ["dementia"]);
});

test("who can see what; paid feature", () => {
  for (const role of ["owner", "administrator", "scheduler", "viewer"]) {
    assert.ok(SYSTEM_ROLE_PERMISSIONS[role].includes("labor.view"), role);
  }
  assert.ok(!SYSTEM_ROLE_PERMISSIONS.scheduler.includes("labor.costs"));
  assert.ok(!SYSTEM_ROLE_PERMISSIONS.viewer.includes("labor.costs"));
  assert.ok(SYSTEM_ROLE_PERMISSIONS.owner.includes("labor.manage"));
  assert.equal(hasFeature("free", "labor"), false);
  assert.equal(hasFeature("starter", "labor"), true);
});

test("Monday email reads well and escapes names", () => {
  const schedules = DAYS.slice(0, 5).map((d) => shift("maria", d, 7, 12));
  const last = base({ schedules, includeCosts: true, settings: { payRates: [{ role: "cna", hourlyRate: 20 }], typicalCensus: 40, budgetHoursPerResidentDay: 0.2 } });
  const current = base({ schedules, staff: [{ ...STAFF[0], name: "<Maria>" }, STAFF[1], STAFF[2]] });
  const html = buildLaborEmail({ facilityName: "Palm & Grove", last, current });
  assert.match(html, /Palm &amp; Grove: labor for Oct 19 – Oct 25/);
  assert.match(html, /Hours per resident day/);
  assert.match(html, /Hours staffed/);
  assert.match(html, /÷ 280 resident days/);
  assert.match(html, /\$1,400/); // 60h*20 + 20h OT*20*0.5
  assert.match(html, /&lt;Maria&gt;/);
  assert.match(html, /goes over Thu Oct 22/);
});

test("GET /labor/report wiring: loads the week, hides costs from schedulers", async () => {
  const models = {
    FacilityPreferences: require("../models/facilityPreferencesModel"),
    LaborSettings: require("../models/laborSettingsModel"),
    Schedule: require("../models/scheduleModel"),
    TimeEntry: require("../models/timeEntryModel"),
    Coverage: require("../models/coverageModel"),
    User: require("../models/userModel"),
  };
  const chain = (result) => {
    const c = { select: () => c, lean: async () => result, sort: () => c };
    return c;
  };
  const originals = Object.fromEntries(Object.entries(models).map(([k, m]) => [k, { find: m.find, findOne: m.findOne }]));
  const seen = {};
  models.FacilityPreferences.findOne = () => chain({ facilityTimezone: "UTC", weekStartsOn: 1, weeklyOvertimeThresholdHours: 40, shiftTypeDefinitions: [] });
  models.LaborSettings.findOne = () => chain({ payRates: [{ role: "cna", hourlyRate: 20 }] });
  models.Schedule.find = (f) => { seen.schedule = f; return chain([shift("maria", DAYS[1], 7, 8)]); };
  models.TimeEntry.find = (f) => { seen.time = f; return chain([]); };
  models.Coverage.find = () => chain([]);
  models.User.find = () => chain(STAFF);
  try {
    const ctrl = require("../controllers/laborController");
    const run = async (roles) => {
      let body, status = 200;
      const res = { status: (s) => { status = s; return res; }, json: (b) => { body = b; } };
      await ctrl.getReport({ tenantId: "6a04bfda5193b12fac01131b", user: { roles, role: roles[0] }, query: { weekStart: "2026-10-19" } }, res, (e) => { throw e; });
      return { body, status };
    };
    const owner = await run(["owner"]);
    assert.equal(owner.status, 200);
    assert.equal(owner.body.hours.scheduled, 8);
    assert.equal(owner.body.costs.scheduled, 160);
    assert.equal(owner.body.canSeeCosts, true);
    assert.equal(owner.body.previous, "2026-10-12");
    // 8 weeks of shifts for the watch list; time clock only for the week.
    assert.equal(seen.schedule.startTime.$gte.toISOString(), "2026-08-31T00:00:00.000Z");
    assert.equal(seen.time.clockInAt.$gte.toISOString(), "2026-10-19T00:00:00.000Z");
    const scheduler = await run(["scheduler"]);
    assert.equal(scheduler.body.costs, null);
    assert.equal(scheduler.body.canSeeCosts, false);
  } finally {
    for (const [k, m] of Object.entries(models)) Object.assign(m, originals[k]);
  }
});

test("PUT /labor/settings validates and saves only what was sent", async () => {
  const LaborSettings = require("../models/laborSettingsModel");
  const User = require("../models/userModel");
  const orig = { fu: LaborSettings.findOneAndUpdate, find: User.find };
  let update;
  LaborSettings.findOneAndUpdate = (q, u) => { update = u; return { lean: async () => ({ ...u.$set, payRates: u.$set.payRates }) }; };
  User.find = () => ({ select: () => ({ lean: async () => [{ _id: "6a04bfda5193b12fac01131c" }] }) });
  try {
    const ctrl = require("../controllers/laborController");
    const call = async (body) => {
      let out, status = 200;
      const res = { status: (s) => { status = s; return res; }, json: (b) => { out = b; } };
      await ctrl.updateSettings({ tenantId: "t", user: { _id: "u" }, body }, res, (e) => { throw e; });
      return { status, out };
    };
    assert.equal((await call({ payRates: [{ role: "CNA", hourlyRate: 900 }] })).status, 400);
    assert.equal((await call({ mondayReport: { extraRecipients: ["nope"] } })).status, 400);
    assert.equal((await call({ budgetHoursPerResidentDay: 30 })).status, 400);
    const ok = await call({
      payRates: [{ role: "CNA", hourlyRate: "18.5" }, { role: "nurse", hourlyRate: "" }],
      staffRates: [{ staffId: "6a04bfda5193b12fac01131c", hourlyRate: 21 }, { staffId: "6a04bfda5193b12fac01131d", hourlyRate: 30 }],
      typicalCensus: "48",
      mondayReport: { extraRecipients: ["VP@Example.com", "vp@example.com"] },
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(update.$set.payRates, [{ role: "cna", hourlyRate: 18.5 }]);
    assert.equal(update.$set.staffRates.length, 1, "staff from another workspace ignored");
    assert.equal(update.$set.typicalCensus, 48);
    assert.deepEqual(update.$set["mondayReport.extraRecipients"], ["vp@example.com"]);
    assert.equal(update.$set.budgetHoursPerResidentDay, undefined, "not sent = not changed");
  } finally {
    LaborSettings.findOneAndUpdate = orig.fu;
    User.find = orig.find;
  }
});

test("needed vs staffed: open spots show as hours still needed; PPD if all filled", () => {
  const r = base({
    schedules: DAYS.map((d) => shift("maria", d, 7, 8)), // 56h staffed
    coverage: DAYS.map((d) => ({ requiredCount: 2, assignedCount: 1, startTime: at(d, 7), endTime: at(d, 15) })), // 112h needed
    settings: { typicalCensus: 10, budgetHoursPerResidentDay: 2 },
  });
  assert.equal(r.hours.scheduled, 56);
  assert.equal(r.hours.needed, 112);
  assert.equal(r.hours.open, 56);
  assert.equal(r.budget.residentsPerDay, 10);
  assert.equal(r.budget.countedDays, 7);
  assert.equal(r.budget.scheduledPPD, 0.8); // 56 / 70
  assert.equal(r.budget.neededPPD, 1.6); // (56 + 56) / 70
  assert.equal(r.budget.budgetHours, 140);
});
