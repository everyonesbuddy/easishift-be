/**
 * Onboarding setup
 * ----------------
 * Step 2: POST /api/v1/setup/facility-type  — applies a preset (roles, shift
 *         times, starting staffing template).
 * Steps 3–5 use the existing endpoints: POST /facility-preferences,
 *         PUT /staffing-template, POST /staff/bulk.
 * Done:   POST /api/v1/setup/complete
 */
const Tenant = require("../models/tenantModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const StaffingTemplate = require("../models/staffingTemplateModel");
const {
  FACILITY_TYPES,
  PRESETS,
  getPresetPreferences,
  getPresetTemplateRules,
} = require("../config/facilityPresets");

/**
 * GET /api/v1/setup/facility-types
 */
exports.listFacilityTypes = (req, res) => {
  res.json(
    FACILITY_TYPES.map((key) => ({
      key,
      label: PRESETS[key].label,
      roles: PRESETS[key].roleFamilies,
    })),
  );
};

/**
 * POST /api/v1/setup/facility-type
 * Body: { facilityType, overwrite?: boolean }
 *
 * During onboarding (setup not completed) the scheduler can switch types
 * freely. After that it won't replace roles/shifts or a template they built
 * unless overwrite is true.
 */
exports.applyFacilityType = async (req, res, next) => {
  try {
    const facilityType = String(req.body?.facilityType || "").trim();
    const overwrite =
      req.body?.overwrite === true || !req.tenant.setupCompletedAt;

    if (!FACILITY_TYPES.includes(facilityType)) {
      return res.status(400).json({
        message: `facilityType must be one of: ${FACILITY_TYPES.join(", ")}`,
      });
    }

    const [prefs, template] = await Promise.all([
      FacilityPreferences.findOne({ tenantId: req.tenantId }),
      StaffingTemplate.findOne({ tenantId: req.tenantId }),
    ]);

    const hasRoles = Boolean(prefs?.roleFamilies?.length);
    const hasRules = Boolean(template?.rules?.length);
    if (!overwrite && (hasRoles || hasRules)) {
      return res.status(409).json({
        message:
          "Your roles, shifts or staffing template are already set up. Send overwrite: true to replace them with the defaults.",
        errorCode: "SETUP_ALREADY_CUSTOMIZED",
      });
    }

    await Tenant.updateOne({ _id: req.tenantId }, { $set: { facilityType } });

    const updatedPrefs = await FacilityPreferences.findOneAndUpdate(
      { tenantId: req.tenantId },
      { $set: getPresetPreferences(facilityType) },
      { new: true, upsert: true, runValidators: true },
    );

    const updatedTemplate = await StaffingTemplate.findOneAndUpdate(
      { tenantId: req.tenantId },
      {
        $set: {
          rules: getPresetTemplateRules(facilityType),
          updatedBy: req.user._id,
        },
      },
      { new: true, upsert: true, runValidators: true },
    );

    res.json({
      facilityType,
      facilityPreferences: updatedPrefs,
      staffingTemplate: updatedTemplate,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/setup/complete
 */
exports.completeSetup = async (req, res, next) => {
  try {
    const now = new Date();
    await Tenant.updateOne(
      { _id: req.tenantId, setupCompletedAt: null },
      { $set: { setupCompletedAt: now } },
    );
    const tenant = await Tenant.findById(req.tenantId)
      .select("setupCompletedAt facilityType")
      .lean();
    res.json(tenant);
  } catch (err) {
    next(err);
  }
};
