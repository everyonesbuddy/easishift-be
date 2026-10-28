const test = require("node:test");
const assert = require("node:assert/strict");

const chain = (result) => {
  const c = { select: () => c, lean: async () => result, sort: () => c, populate: () => c, limit: () => c };
  return c;
};

test("GET /summary/today: open spots, today's shifts, call-outs, on now, requests", async () => {
  const wsPath = require.resolve("../utils/weekService");
  const saved = require.cache[wsPath];
  const realWs = require(wsPath);
  require.cache[wsPath] = {
    id: wsPath, filename: wsPath, loaded: true,
    exports: {
      ...realWs,
      getWeekSettings: async () => ({ timezone: "UTC", weekStartsOn: 1, prefs: {} }),
      ensureWeek: async ({ weekStart }) => ({ weekStart, status: "published" }),
    },
  };
  const Coverage = require("../models/coverageModel");
  const Schedule = require("../models/scheduleModel");
  const TimeOff = require("../models/timeOffModel");
  const ShiftSwap = require("../models/shiftSwapModel");
  const FacilityPreferences = require("../models/facilityPreferencesModel");
  const orig = {
    cf: Coverage.find, sf: Schedule.find, sa: Schedule.aggregate, tf: TimeOff.find, wf: ShiftSwap.find, ff: FacilityPreferences.findOne,
  };
  // "Now" is real time; build the day around it.
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const h = (offset) => new Date(now.getTime() + offset * 3600e3);
  const cov1 = "6a04bfda5193b12fac020001"; // on now, 2 needed, 1 on
  const cov2 = "6a04bfda5193b12fac020002"; // later today, 1 needed, full
  const coverage = [
    { _id: cov1, date: new Date(`${day}T00:00:00Z`), role: "cna", shiftType: "day", shiftTag: "d", startTime: h(-1), endTime: h(7), requiredCount: 2 },
    { _id: cov2, date: new Date(`${day}T00:00:00Z`), role: "nurse", shiftType: "day", shiftTag: "d", startTime: h(-1), endTime: h(7), requiredCount: 1 },
  ];
  const schedules = [
    { _id: "a", coverageId: cov1, staffId: { name: "Kim Tran" }, role: "cna", shiftType: "day", shiftTag: "d", startTime: h(-1), endTime: h(7), status: "scheduled", state: "published" },
    { _id: "b", coverageId: cov1, staffId: { name: "Maria Lopez" }, role: "cna", shiftType: "day", shiftTag: "d", startTime: h(-1), endTime: h(7), status: "call_out" },
    { _id: "c", coverageId: cov2, staffId: { name: "Jo Bell" }, role: "nurse", shiftType: "day", shiftTag: "d", startTime: h(-1), endTime: h(7), status: "scheduled" },
  ];
  Coverage.find = () => chain(coverage);
  Schedule.find = () => chain(schedules);
  Schedule.aggregate = async () => [{ _id: cov1, assignedCount: 1 }, { _id: cov2, assignedCount: 1 }];
  TimeOff.find = () => chain([{ _id: "t", staffId: { name: "Ana Diaz" }, startTime: h(48), endTime: h(72), reason: "Wedding" }]);
  ShiftSwap.find = () => chain([]);
  FacilityPreferences.findOne = () => chain({ shiftTypeDefinitions: [{ key: "day", timeSlots: [{ tag: "d", label: "Day 7a–3p" }] }] });
  const ctrlPath = require.resolve("../controllers/summaryController");
  delete require.cache[ctrlPath];
  try {
    const ctrl = require(ctrlPath);
    let body;
    const res = { status: () => res, json: (b) => { body = b; } };
    await ctrl.getToday({ tenantId: "6a04bfda5193b12fac01131b", user: { roles: ["scheduler"], role: "scheduler" } }, res, (e) => { throw e; });
    assert.equal(body.days.length, 3);
    assert.equal(body.days[0], day);
    assert.equal(body.openSlots.length, 1);
    const open = body.openSlots[0];
    assert.equal(open.open, 1);
    assert.equal(open.label, "Day 7a–3p");
    assert.equal(open.weekPublished, true);
    assert.deepEqual(open.people.map((p) => p.staffId.name), ["Kim Tran"]);
    assert.equal(open.callOuts, 1);
    assert.equal(body.todayShifts.length, 1);
    assert.deepEqual([body.todayShifts[0].required, body.todayShifts[0].assigned, body.todayShifts[0].open], [3, 2, 1]);
    assert.equal(body.onNow.count, 2);
    assert.deepEqual(body.callOuts.map((c) => [c.name, c.stillOpen]), [["Maria Lopez", 1]]);
    assert.equal(body.timeOff[0].name, "Ana Diaz");
    assert.equal(body.totals.openToday, 1);
    assert.equal(body.can.manage, true);
  } finally {
    Object.assign(Coverage, { find: orig.cf });
    Object.assign(Schedule, { find: orig.sf, aggregate: orig.sa });
    TimeOff.find = orig.tf;
    ShiftSwap.find = orig.wf;
    FacilityPreferences.findOne = orig.ff;
    if (saved) require.cache[wsPath] = saved; else delete require.cache[wsPath];
    delete require.cache[ctrlPath];
  }
});
