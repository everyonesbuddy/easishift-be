const FacilityPreferences = require("../models/facilityPreferencesModel");

const buildLimitedFacilityPreferencesView = (prefs) => {
  if (!prefs) return null;

  const timeTracking = prefs.timeTracking || {};

  return {
    tenantId: prefs.tenantId,
    facilityTimezone: prefs.facilityTimezone,
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

// Admin gets full config. Non-admin users receive a limited read-only view.
exports.getFacilityPreferences = async (req, res, next) => {
  try {
    let prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId });

    if (!prefs) {
      // Return schema defaults without persisting — let the admin decide when to save
      prefs = new FacilityPreferences({ tenantId: req.tenantId });
    }

    if (req.user && req.user.role !== "admin") {
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
