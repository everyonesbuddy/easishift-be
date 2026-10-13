/**
 * Staffing template
 * -----------------
 * GET /api/v1/staffing-template
 * PUT /api/v1/staffing-template  { rules, applyTo: "unpublished" | "all_future" }
 */
const StaffingTemplate = require("../models/staffingTemplateModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const Coverage = require("../models/coverageModel");
const User = require("../models/userModel");
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

// Every unit area / certification this facility already uses anywhere:
// preferences, staff tags and existing coverage. These are the choices
// offered in Weekly Needs, so a rule matches the staff tagged the same way.
const collectOptions = async (tenantId, prefs) => {
  const [staffAreas, staffCerts, coverageAreas, coverageCerts] = await Promise.all([
    User.distinct("allowedAreas", { tenantId }),
    User.distinct("certificationTags", { tenantId }),
    Coverage.distinct("unitArea", { tenantId }),
    Coverage.distinct("requiredCertificationTags", { tenantId }),
  ]);
  const merge = (...lists) => {
    const byKey = new Map();
    for (const value of lists.flat()) {
      const key = tagKey(value);
      if (key && !byKey.has(key)) byKey.set(key, key);
    }
    return [...byKey.values()].sort();
  };
  return {
    unitAreas: merge(prefs?.unitAreas || [], staffAreas, coverageAreas),
    certificationTags: merge(prefs?.certificationTags || [], staffCerts, coverageCerts),
  };
};
exports._collectOptions = collectOptions;

exports.getTemplate = async (req, res, next) => {
  try {
    const [template, prefs] = await Promise.all([
      StaffingTemplate.findOne({ tenantId: req.tenantId }).lean(),
      FacilityPreferences.findOne({ tenantId: req.tenantId })
        .select("unitAreas certificationTags")
        .lean(),
    ]);
    const options = await collectOptions(req.tenantId, prefs);
    res.json({ ...(template || { tenantId: req.tenantId, rules: [] }), options });
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

    const prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId })
      .select("roleFamilies shiftTypeDefinitions unitAreas certificationTags")
      .lean();
    const slotLookup = buildShiftSlotLookup(prefs);
    const roles = new Set((prefs?.roleFamilies || []).map(normalizeKey));
    // New areas and certifications are added to facility preferences on
    // save, so staff can be tagged with the same values and matched.
    const areaByKey = new Map(
      (prefs?.unitAreas || []).map((area) => [tagKey(area), area]),
    );
    const certByKey = new Map(
      (prefs?.certificationTags || []).map((tag) => [tagKey(tag), tag]),
    );

    const newAreas = [];
    const newCerts = [];
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
      if (areaKey && !areaByKey.has(areaKey)) {
        if (areaKey.length > 60) {
          return res.status(400).json({
            message: `Rule ${index + 1}: unit area '${input.unitArea}' is too long`,
          });
        }
        areaByKey.set(areaKey, areaKey);
        newAreas.push(areaKey);
      }
      // Stored as lowercase_with_underscores; matching ignores spaces vs underscores.
      const unitArea = areaKey || null;
      const certInputs = Array.isArray(input?.requiredCertificationTags)
        ? input.requiredCertificationTags.map(tagKey).filter(Boolean)
        : [];
      const longCert = certInputs.find((tag) => tag.length > 60);
      if (longCert) {
        return res.status(400).json({
          message: `Rule ${index + 1}: certification '${longCert}' is too long`,
        });
      }
      for (const tag of certInputs) {
        if (!certByKey.has(tag)) {
          certByKey.set(tag, tag);
          newCerts.push(tag);
        }
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

    if (newAreas.length || newCerts.length) {
      await FacilityPreferences.updateOne(
        { tenantId: req.tenantId },
        {
          $addToSet: {
            unitAreas: { $each: newAreas },
            certificationTags: { $each: newCerts },
          },
        },
      );
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

    res.json({
      template,
      weeksUpdated,
      addedToPreferences: { unitAreas: newAreas, certificationTags: newCerts },
    });
  } catch (err) {
    next(err);
  }
};
