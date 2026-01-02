const Coverage = require("../models/coverageModel");
const Schedule = require("../models/scheduleModel");

// Normalize to UTC midnight
function normalizeToUTC(date) {
  const d = new Date(date);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

// CREATE
exports.createCoverage = async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admins only" });

    const { date, role, requiredCount, note, startTime, endTime } = req.body;

    const normalizedDate = normalizeToUTC(date);

    const doc = await Coverage.create({
      tenantId: req.tenantId,
      date: normalizedDate,
      role,
      startTime, // already UTC
      endTime, // already UTC
      requiredCount,
      note,
    });

    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
};

// GET
exports.getCoverage = async (req, res, next) => {
  try {
    const filter = { tenantId: req.tenantId };

    if (req.query.date) {
      filter.date = normalizeToUTC(req.query.date);
    }

    if (req.query.month && req.query.year) {
      const y = Number(req.query.year);
      const m = Number(req.query.month);
      const start = new Date(Date.UTC(y, m - 1, 1));
      const end = new Date(Date.UTC(y, m, 1));
      filter.date = { $gte: start, $lt: end };
    }

    if (req.query.role) filter.role = req.query.role;

    const list = await Coverage.find(filter).sort({ date: 1, startTime: 1 });
    res.json(list);
  } catch (err) {
    next(err);
  }
};

// UPDATE
exports.updateCoverage = async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admins only" });

    const id = req.params.id;
    const update = { ...req.body };

    if (update.date) update.date = normalizeToUTC(update.date);

    const updated = await Coverage.findOneAndUpdate(
      { _id: id, tenantId: req.tenantId },
      update,
      { new: true }
    );

    if (!updated)
      return res.status(404).json({ message: "Coverage not found" });

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// DELETE
exports.deleteCoverage = async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ message: "Admins only" });

    const removed = await Coverage.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!removed)
      return res.status(404).json({ message: "Coverage not found" });

    res.json({ message: "Coverage deleted" });
  } catch (err) {
    next(err);
  }
};

// GET unfilled coverage
exports.getUnfilledCoverage = async (req, res, next) => {
  try {
    const { role } = req.query;
    const tenantId = req.tenantId;

    if (!role) return res.status(400).json({ message: "role is required" });

    // 1. Get all coverages for this role
    const coverages = await Coverage.find({
      tenantId,
      role,
    }).sort({ date: 1, startTime: 1 });

    if (!coverages.length) return res.json([]);

    // 2. Get schedules that match these coverage times
    const coverageIds = coverages.map((c) => c._id.toString());

    const schedules = await Schedule.find({
      tenantId,
      role,
      status: { $nin: ["completed", "cancelled"] },
      $or: coverages.map((c) => ({
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    });

    // 3. Count how many staff are assigned per coverage
    const scheduleCountMap = {};

    schedules.forEach((s) => {
      const key = `${s.startTime.toISOString()}-${s.endTime.toISOString()}`;
      if (!scheduleCountMap[key]) scheduleCountMap[key] = 0;
      scheduleCountMap[key]++;
    });

    // 4. Build response
    const result = coverages.map((cov) => {
      const key = `${cov.startTime.toISOString()}-${cov.endTime.toISOString()}`;
      const assigned = scheduleCountMap[key] || 0;

      return {
        ...cov.toObject(),
        assignedCount: assigned,
        remaining: Math.max(0, cov.requiredCount - assigned),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};

// GET unfilled coverages for auto-generation
exports.getUnfilledCoverageForAuto = async (req, res, next) => {
  try {
    const { role } = req.query; // optional
    const tenantId = req.tenantId;

    // 1. Get all coverages, optionally filtered by role
    const filter = { tenantId };
    if (role) filter.role = role;

    const coverages = await Coverage.find(filter).sort({
      date: 1,
      startTime: 1,
    });

    if (!coverages.length) return res.json([]);

    // 2. Find schedules that match these coverage times.
    // If a role was provided, include it so we only count schedules for that role.
    const scheduleQuery = {
      tenantId,
      status: { $nin: ["completed", "cancelled"] },
      $or: coverages.map((c) => ({
        startTime: c.startTime,
        endTime: c.endTime,
      })),
    };

    if (role) scheduleQuery.role = role;

    const schedules = await Schedule.find(scheduleQuery);

    // 3. Count how many staff are assigned per coverage.
    // Use a composite key that includes role so schedules for different roles
    // but the same times don't get mixed together when `role` query is absent.
    const scheduleCountMap = {};
    schedules.forEach((s) => {
      const key = `${
        s.role || ""
      }-${s.startTime.toISOString()}-${s.endTime.toISOString()}`;
      if (!scheduleCountMap[key]) scheduleCountMap[key] = 0;
      scheduleCountMap[key]++;
    });

    // 4. Build response
    const result = coverages.map((cov) => {
      const key = `${
        cov.role || ""
      }-${cov.startTime.toISOString()}-${cov.endTime.toISOString()}`;
      const assigned = scheduleCountMap[key] || 0;
      return {
        ...cov.toObject(),
        assignedCount: assigned,
        remaining: Math.max(0, cov.requiredCount - assigned),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};
