/**
 * Staffing template
 * -----------------
 * GET /api/v1/staffing-template
 * PUT /api/v1/staffing-template  { rules, applyTo: "unpublished" | "all_future" }
 */
const StaffingTemplate = require("../models/staffingTemplateModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const {
  buildShiftSlotLookup,
  normalizeShiftType,
  normalizeShiftTag,
} = require("../utils/dateUtils");
const { syncTemplateToWeeks } = require("../utils/weekService");
const { tagKey } = require("../utils/tagKey");

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

exports.getTemplate = async (req, res, next) => {
  try {
    const template = await StaffingTemplate.findOne({ tenantId: req.tenantId });
    res.json(template || { tenantId: req.tenantId, rules: [] });
  } catch (err) {
    next(err);
  }
};

exports.saveTemplate = async (req, res, next) => {
  try {
    const { rules, applyTo = "unpublished" } = req.body || {};
    if (!Array.isArray(rules)) {
      return res.status(400).json({ message: "rules must be an array" });
    }
    if (!["unpublished", "all_future"].includes(applyTo)) {
      return res
        .status(400)
        .json({ message: "applyTo must be unpublished or all_future" });
    }

    const [prefs, current] = await Promise.all([
      FacilityPreferences.findOne({ tenantId: req.tenantId })
        .select("roleFamilies shiftTypeDefinitions unitAreas certificationTags")
        .lean(),
      StaffingTemplate.findOne({ tenantId: req.tenantId }).select("rules").lean(),
    ]);
    const slotLookup = buildShiftSlotLookup(prefs);
    const roles = new Set((prefs?.roleFamilies || []).map(normalizeKey));
    // Unit areas and certifications come from facility preferences (the
    // same list staff are tagged from). Values already on the saved
    // template stay valid so older data can still be saved.
    const savedRules = current?.rules || [];
    const areaKeys = new Set([
      ...(prefs?.unitAreas || []).map(tagKey),
      ...savedRules.map((r) => tagKey(r.unitArea)).filter(Boolean),
    ]);
    const certKeys = new Set([
      ...(prefs?.certificationTags || []).map(tagKey),
      ...savedRules.flatMap((r) => (r.requiredCertificationTags || []).map(tagKey)),
    ]);

    const seen = new Set();
    const cleaned = [];
    for (const [index, input] of rules.entries()) {
      const shiftType = normalizeShiftType(input?.shiftType);
      const shiftTag = normalizeShiftTag(input?.shiftTag);
      const role = normalizeKey(input?.role);
      const areaKey = input?.unitArea ? tagKey(input.unitArea) : null;
      const counts = input?.countsByWeekday;

      if (!slotLookup.has(`${shiftType}:${shiftTag}`)) {
        return res.status(400).json({
          message: `Rule ${index + 1}: unknown shift '${input?.shiftType}:${input?.shiftTag}'. Add it under shift times first.`,
        });
      }
      if (!roles.has(role)) {
        return res.status(400).json({
          message: `Rule ${index + 1}: unknown role '${input?.role}'. Add it to your facility roles first.`,
        });
      }
      if (
        !Array.isArray(counts) ||
        counts.length !== 7 ||
        !counts.every((n) => Number.isInteger(n) && n >= 0 && n <= 50)
      ) {
        return res.status(400).json({
          message: `Rule ${index + 1}: countsByWeekday must be 7 whole numbers (Sunday first) between 0 and 50`,
        });
      }
      if (areaKey && !areaKeys.has(areaKey)) {
        return res.status(400).json({
          message: `Rule ${index + 1}: unknown unit area '${input.unitArea}'. Add it in Facility Preferences first.`,
        });
      }
      // Stored as lowercase_with_underscores; matching ignores spaces vs underscores.
      const unitArea = areaKey || null;
      const certInputs = Array.isArray(input?.requiredCertificationTags)
        ? input.requiredCertificationTags.map(tagKey).filter(Boolean)
        : [];
      const unknownCert = certInputs.find((tag) => !certKeys.has(tag));
      if (unknownCert) {
        return res.status(400).json({
          message: `Rule ${index + 1}: unknown certification '${unknownCert}'. Add it in Facility Preferences first.`,
        });
      }
      const requiredCertificationTags = Array.from(new Set(certInputs));

      const key = [shiftType, shiftTag, role, areaKey || ""].join("|");
      if (seen.has(key)) {
        return res.status(400).json({
          message: `Rule ${index + 1}: ${role} on ${shiftType}${unitArea ? ` in ${unitArea}` : ""} is listed twice`,
        });
      }
      seen.add(key);

      cleaned.push({
        ...(input?._id ? { _id: input._id } : {}),
        shiftType,
        shiftTag,
        role,
        unitArea,
        requiredCertificationTags,
        countsByWeekday: counts,
      });
    }

    const template = await StaffingTemplate.findOneAndUpdate(
      { tenantId: req.tenantId },
      { $set: { rules: cleaned, updatedBy: req.user._id } },
      { new: true, upsert: true, runValidators: true },
    );

    const { weeksUpdated } = await syncTemplateToWeeks({
      tenantId: req.tenantId,
      applyTo,
    });

    res.json({ template, weeksUpdated });
  } catch (err) {
    next(err);
  }
};
