const FacilityPreferences = require("../models/facilityPreferencesModel");
const { DateTime } = require("luxon");
const { hasPermission } = require("../config/authorization");

const isValidIanaZone = (value) =>
  DateTime.local().setZone(String(value || "").trim()).isValid;

const buildLimitedFacilityPreferencesView = (prefs) => {
  if (!prefs) return null;

  const timeTracking = prefs.timeTracking || {};

  return {
    tenantId: prefs.tenantId,
    facilityTimezone: prefs.facilityTimezone,
    facilityTimezoneConfirmed: Boolean(prefs.facilityTimezoneConfirmed),
    timeTracking: {
      enabled: Boolean(timeTracking.enabled),
      mode: timeTracking.mode || "open",
      requireScheduleMatch: true,
      clockInGraceMinutes: timeTracking.clockInGraceMinutes ?? 15,
      clockOutGraceMinutes: timeTracking.clockOutGraceMinutes ?? 30,
      roundingMinutes: timeTracking.roundingMinutes ?? 0,
      autoCloseOpenBreakOnClockOut: true,
    },
  };
};

const buildSchedulingFacilityPreferencesView = (prefs) => {
  if (!prefs) return null;

  return {
    tenantId: prefs.tenantId,
    facilityTimezone: prefs.facilityTimezone,
    facilityTimezoneConfirmed: Boolean(prefs.facilityTimezoneConfirmed),
    roleFamilies: prefs.roleFamilies || [],
    unitAreas: prefs.unitAreas || [],
    shiftTypes: prefs.shiftTypes || [],
    shiftTypeDefinitions: prefs.shiftTypeDefinitions || [],
    certificationTags: prefs.certificationTags || [],
    schedulingPattern: prefs.schedulingPattern || "balance",
    weeklyOvertimeThresholdHours: prefs.weeklyOvertimeThresholdHours ?? 40,
    fairnessLookbackDays: prefs.fairnessLookbackDays ?? 28,
    timeTracking: {
      enabled: Boolean(prefs.timeTracking?.enabled),
      mode: prefs.timeTracking?.mode || "open",
    },
  };
};

// Managers get the full config. Schedulers get scheduling fields only.
exports.getFacilityPreferences = async (req, res, next) => {
  try {
    let prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId });

    if (!prefs) {
      // Return schema defaults without persisting — let the admin decide when to save
      prefs = new FacilityPreferences({ tenantId: req.tenantId });
    }

    if (req.user && hasPermission(req.user, "facility_preferences.manage")) {
      return res.json(prefs);
    }

    if (req.user && hasPermission(req.user, "facility_preferences.view")) {
      return res.json(buildSchedulingFacilityPreferencesView(prefs));
    }

    if (req.user) {
      return res.json(buildLimitedFacilityPreferencesView(prefs));
    }

    res.json(prefs);
  } catch (err) {
    next(err);
  }
};

// ADMIN: Create or update this facility's preferences
exports.upsertFacilityPreferences = async (req, res, next) => {
  try {
    // Strip fields that should never be overwritten via this endpoint
    const {
      tenantId: _t,
      _id: _i,
      createdAt: _c,
      updatedAt: _u,
      // Derived from an explicit facilityTimezone save, never client-supplied.
      facilityTimezoneConfirmed: _tzc,
      ...updates
    } = req.body;

    const hasNestedTimeTrackingUpdate =
      updates.timeTracking && typeof updates.timeTracking === "object";

    if (hasNestedTimeTrackingUpdate) {
      updates.timeTracking = {
        ...updates.timeTracking,
        requireScheduleMatch: true,
        autoCloseOpenBreakOnClockOut: true,
      };
    }

    // Also guard dot-notation payloads from clients.
    if (
      Object.prototype.hasOwnProperty.call(
        updates,
        "timeTracking.requireScheduleMatch",
      )
    ) {
      if (hasNestedTimeTrackingUpdate) {
        delete updates["timeTracking.requireScheduleMatch"];
      } else {
        updates["timeTracking.requireScheduleMatch"] = true;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(
        updates,
        "timeTracking.autoCloseOpenBreakOnClockOut",
      )
    ) {
      if (hasNestedTimeTrackingUpdate) {
        delete updates["timeTracking.autoCloseOpenBreakOnClockOut"];
      } else {
        updates["timeTracking.autoCloseOpenBreakOnClockOut"] = true;
      }
    }

    if (Array.isArray(updates.unitAreas)) {
      updates.unitAreas = Array.from(
        new Set(
          updates.unitAreas
            .map((value) =>
              String(value || "")
                .trim()
                .toLowerCase(),
            )
            .filter(Boolean),
        ),
      );
    }

    // An explicit save is what flips the field from "never configured".
    if (updates.facilityTimezone !== undefined) {
      const timezone = String(updates.facilityTimezone || "").trim();

      if (!isValidIanaZone(timezone)) {
        return res.status(400).json({
          message: `Invalid timezone '${updates.facilityTimezone}'. Expected an IANA timezone such as 'America/New_York'.`,
          errorCode: "INVALID_TIMEZONE",
        });
      }

      updates.facilityTimezone = timezone;
      updates.facilityTimezoneConfirmed = true;
    }

    const prefs = await FacilityPreferences.findOneAndUpdate(
      { tenantId: req.tenantId },
      { $set: updates },
      { new: true, upsert: true, runValidators: true },
    );

    res.json(prefs);
  } catch (err) {
    next(err);
  }
};

// ADMIN: Reset to schema defaults
exports.resetFacilityPreferences = async (req, res, next) => {
  try {
    await FacilityPreferences.findOneAndDelete({ tenantId: req.tenantId });

    // Return a fresh default document
    const fresh = new FacilityPreferences({ tenantId: req.tenantId });
    res.json(fresh);
  } catch (err) {
    next(err);
  }
};
