const test = require("node:test");
const assert = require("node:assert/strict");
const { weeklyNeedsParser, slotList } = require("../config/nlWeeklyNeedsParser");
const { getFormParserConfig, isFormParserImplemented } = require("../config/nlFormParsers");

const PREFS = {
  roleFamilies: ["CNA", "med_tech", "nurse"],
  unitAreas: ["Memory Care"],
  shiftTypeDefinitions: [
    { key: "day", timeSlots: [{ tag: "day_8h", label: "Day", startLocalTime: "07:00", endLocalTime: "15:00" }] },
    { key: "night", timeSlots: [{ tag: "night_8h", label: "Night", startLocalTime: "23:00", endLocalTime: "07:00" }] },
  ],
};
const config = getFormParserConfig("weeklyNeeds");
const ctx = config.buildContext(PREFS);
const all = (n) => ({ sun: n, mon: n, tue: n, wed: n, thu: n, fri: n, sat: n });

test("registered and complete", () => {
  assert.ok(isFormParserImplemented(config));
  assert.equal(config.permission, "coverage.manage");
  assert.deepEqual(slotList(ctx).map((s) => s.key), ["day:day_8h", "night:night_8h"]);
});

test("tool limits the model to this facility's shifts, roles and areas", () => {
  const tool = weeklyNeedsParser.buildTool(ctx);
  const item = tool.input_schema.properties.rows.items.properties;
  assert.deepEqual(item.shift.enum, ["day:day_8h", "night:night_8h"]);
  assert.deepEqual(item.role.enum, ["cna", "med_tech", "nurse"]);
  assert.deepEqual(item.unitArea.enum, ["memory care"]);
  const prompt = weeklyNeedsParser.buildSystemPrompt(ctx);
  assert.match(prompt, /day:day_8h: Day \(07:00–15:00\)/);
});

test("no unit areas: the field is left out of the tool", () => {
  const c = config.buildContext({ ...PREFS, unitAreas: [] });
  assert.equal(weeklyNeedsParser.buildTool(c).input_schema.properties.rows.items.properties.unitArea, undefined);
});

test("normalizes to Sunday-first counts, keeps nulls, clamps, merges repeats", () => {
  const draft = weeklyNeedsParser.normalizeDraft(
    {
      rows: [
        { shift: "day:day_8h", role: "CNA", counts: { sun: 3, mon: 4, tue: 4, wed: 4, thu: 4, fri: 4, sat: 3 } },
        { shift: "night:night_8h", role: "nurse", unitArea: "Memory Care", counts: { ...all(null), mon: 99, tue: "2" } },
        { shift: "day:day_8h", role: "cna", counts: { ...all(null), sat: 2 } },
      ],
      notUnderstood: ["LPN isn't a role here", ""],
    },
    ctx,
  );
  assert.equal(draft.rows.length, 2);
  assert.deepEqual(draft.rows[0], {
    shiftType: "day", shiftTag: "day_8h", role: "cna", unitArea: null, countsByWeekday: [3, 4, 4, 4, 4, 4, 2],
  });
  assert.deepEqual(draft.rows[1].countsByWeekday, [null, 50, 2, null, null, null, null]);
  assert.equal(draft.rows[1].unitArea, "memory care");
  assert.deepEqual(draft.notUnderstood, ["LPN isn't a role here"]);
  assert.equal(weeklyNeedsParser.validateDraft(draft, ctx).valid, true);
});

test("rows outside the facility's setup are dropped with a note", () => {
  const draft = weeklyNeedsParser.normalizeDraft(
    {
      rows: [
        { shift: "evening:eve", role: "cna", counts: all(1) },
        { shift: "day:day_8h", role: "lpn", counts: all(1) },
        { shift: "day:day_8h", role: "cna", unitArea: "rehab", counts: all(1) },
        { shift: "day:day_8h", role: "nurse", counts: all(null) },
        { shift: "day:day_8h", role: "med_tech", counts: all(1) },
      ],
    },
    ctx,
  );
  assert.deepEqual(draft.rows.map((r) => r.role), ["med_tech"]);
  assert.equal(draft.notUnderstood.length, 3);
  assert.match(draft.notUnderstood[1], /the role "lpn"/);
  assert.equal(weeklyNeedsParser.validateDraft(draft, ctx).valid, true);
  // A draft that skipped normalizing is still checked.
  const raw = { rows: [{ shiftType: "x", shiftTag: "y", role: "lpn", unitArea: null, countsByWeekday: [1, 1, 1, 1, 1, 1, 1] }] };
  assert.equal(weeklyNeedsParser.validateDraft(raw, ctx).valid, false);
});

test("nothing understood is still a valid answer when it says why", () => {
  const draft = weeklyNeedsParser.normalizeDraft({ rows: [], notUnderstood: ["No numbers given"] }, ctx);
  assert.equal(weeklyNeedsParser.validateDraft(draft, ctx).valid, true);
  assert.equal(weeklyNeedsParser.validateDraft({ rows: [], notUnderstood: [] }, ctx).valid, false);
});

test("missing setup is reported before calling the model", () => {
  const gaps = weeklyNeedsParser.describeGaps(config.buildContext({}));
  assert.deepEqual(gaps.map((g) => g.field), ["roleFamilies", "shiftTypeDefinitions"]);
});

test("POST /nl/parse weeklyNeeds: sends current rules, returns a checked draft", async () => {
  const clientPath = require.resolve("../utils/anthropicClient");
  const ctrlPath = require.resolve("../controllers/nlParseController");
  const FacilityPreferences = require("../models/facilityPreferencesModel");
  const savedClient = require.cache[clientPath];
  const realClient = require(clientPath);
  const originalFind = FacilityPreferences.findOne;
  let sent = null;
  require.cache[clientPath] = {
    id: clientPath, filename: clientPath, loaded: true,
    exports: {
      ...realClient,
      callAnthropicTool: async (args) => {
        sent = args;
        return { rows: [{ shift: "night:night_8h", role: "cna", counts: all(2) }] };
      },
    },
  };
  delete require.cache[ctrlPath];
  FacilityPreferences.findOne = () => ({ lean: async () => PREFS });
  try {
    const ctrl = require(ctrlPath);
    let body = null;
    const res = { json: (b) => { body = b; }, status: () => res };
    const rules = [{ shiftType: "day", shiftTag: "day_8h", role: "cna", countsByWeekday: [3, 4, 4, 4, 4, 4, 3] }];
    await ctrl.parseForm(
      {
        tenantId: "t1",
        user: { role: "admin", permissions: ["coverage.manage"] },
        body: { formType: "weeklyNeeds", message: "two aides every night", currentFormState: { rules } },
      },
      res,
      (err) => { throw err; },
    );
    assert.equal(sent.maxTokens, 2048);
    assert.equal(sent.tool.name, "submit_weekly_needs");
    assert.deepEqual(JSON.parse(sent.userMessage).currentFormState.rules, rules);
    assert.deepEqual(body.draft.rows, [
      { shiftType: "night", shiftTag: "night_8h", role: "cna", unitArea: null, countsByWeekday: [2, 2, 2, 2, 2, 2, 2] },
    ]);
  } finally {
    FacilityPreferences.findOne = originalFind;
    if (savedClient) require.cache[clientPath] = savedClient; else delete require.cache[clientPath];
    delete require.cache[ctrlPath];
  }
});

test("route: Free gets 402, paid is limited per workspace per minute", async () => {
  const express = require("express");
  const http = require("node:http");
  const stub = (rel, exports) => {
    const p = require.resolve(rel);
    const saved = require.cache[p];
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
    return () => { if (saved) require.cache[p] = saved; else delete require.cache[p]; };
  };
  const { getPlan } = require("../config/plans");
  const routesPath = require.resolve("../routes/nlRoutes");
  const restore = [
    stub("../middleware/authMiddleware", (req, _res, next) => next()),
    stub("../middleware/tenantMiddleware", (req, _res, next) => {
      req.tenantId = req.headers["x-tenant"];
      req.plan = getPlan(req.headers["x-plan"]);
      req.tenant = { _id: req.tenantId, trialUsedAt: new Date() };
      next();
    }),
    stub("../controllers/nlParseController", { parseForm: (_req, res) => res.json({ ok: true }) }),
  ];
  delete require.cache[routesPath];
  const app = express();
  app.use(express.json());
  app.use("/nl", require(routesPath));
  const server = app.listen(0);
  const { port } = server.address();
  const post = (tenant, plan, formType = "weeklyNeeds") =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify({ formType, message: "x" });
      const req = http.request(
        { port, path: "/nl/parse", method: "POST", headers: { "content-type": "application/json", "x-tenant": tenant, "x-plan": plan } },
        (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); },
      );
      req.on("error", reject);
      req.end(body);
    });
  try {
    assert.equal(await post("free1", "free"), 402);
    const { DESCRIBE_PER_MINUTE } = require(routesPath);
    for (let i = 0; i < DESCRIBE_PER_MINUTE; i += 1) assert.equal(await post("paid1", "starter"), 200);
    assert.equal(await post("paid1", "starter"), 429);
    assert.equal(await post("paid2", "growth"), 200, "another workspace has its own limit");
    assert.equal(await post("paid1", "starter", "coverage"), 200, "other form types aren't limited here");
  } finally {
    server.close();
    restore.forEach((r) => r());
    delete require.cache[routesPath];
  }
});
