const FacilityPreferences = require("../models/facilityPreferencesModel");
const { DateTime } = require("luxon");
const { hasPermission } = require("../config/authorization");
const { hasFeature, requiredPlanFor, trialAvailable } = require("../config/plans");

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

    // Turning on the time clock is a paid-plan feature.
    const enablingTimeClock =
      (hasNestedTimeTrackingUpdate && updates.timeTracking.enabled === true) ||
      updates["timeTracking.enabled"] === true;
    if (enablingTimeClock && !hasFeature(req.plan?.key, "timeClock")) {
      return res.status(402).json({
        message: "The time clock needs the Starter plan",
        errorCode: "PLAN_FEATURE_REQUIRED",
        feature: "timeClock",
        currentPlan: req.plan?.key || null,
        requiredPlan: requiredPlanFor("timeClock"),
        trialAvailable: trialAvailable(req.tenant),
      });
    }

    if (
      updates.weekStartsOn !== undefined &&
      !(Number.isInteger(updates.weekStartsOn) &&
        updates.weekStartsOn >= 0 &&
        updates.weekStartsOn <= 6)
    ) {
      return res
        .status(400)
        .json({ message: "weekStartsOn must be 0 (Sunday) to 6 (Saturday)" });
    }

    // Role workweeks: check the list whenever it's sent.
    if (updates.roleWeekStarts !== undefined) {
      if (!Array.isArray(updates.roleWeekStarts) || updates.roleWeekStarts.length > 10) {
        return res.status(400).json({ message: "roleWeekStarts must be a list of up to 10 groups" });
      }
      for (const g of updates.roleWeekStarts) {
        const day = Number(g?.weekStartsOn);
        if (!Number.isInteger(day) || day < 0 || day > 6) return res.status(400).json({ message: "Each group's weekStartsOn must be 0 (Sunday) to 6 (Saturday)" });
        if (!Array.isArray(g.roles) || !g.roles.some((r) => String(r || "").trim())) return res.status(400).json({ message: "Each group needs at least one role" });
      }
      const all = updates.roleWeekStarts.flatMap((g) => g.roles.map((r) => String(r || "").trim().toLowerCase()).filter(Boolean));
      const dup = all.find((r, i) => all.indexOf(r) !== i);
      if (dup) return res.status(400).json({ message: `"${dup}" is in two groups. Each role can only have one workweek.` });
    }

    // Workweeks decide how overtime is counted for everyone, so only owners
    // and administrators change them (not schedulers).
    const current = await FacilityPreferences.findOne({ tenantId: req.tenantId }).select("weekStartsOn roleWeekStarts").lean();
    const changesWeek = updates.weekStartsOn !== undefined && updates.weekStartsOn !== (current?.weekStartsOn ?? 0);
    if (updates.weekStartsOn !== undefined && !changesWeek) delete updates.weekStartsOn;
    // The settings page sends everything on every save, so only a real change counts.
    const { cleanRoleWeekStarts } = require("../utils/workweek");
    const changesRoleWeeks =
      updates.roleWeekStarts !== undefined &&
      (!Array.isArray(updates.roleWeekStarts) || JSON.stringify(cleanRoleWeekStarts(updates.roleWeekStarts)) !== JSON.stringify(cleanRoleWeekStarts(current?.roleWeekStarts)));
    if (updates.roleWeekStarts !== undefined && !changesRoleWeeks) delete updates.roleWeekStarts;
    // Moving the building's week is the owner's or an administrator's call. Role
    // workweeks anyone who manages settings can change (schedulers too), and every
    // change is recorded and emailed to the owner and administrators.
    if (changesWeek && !hasPermission(req.user, "tenant.settings")) {
      return res.status(403).json({ message: "Only the owner or an administrator can change the building's week." });
    }
    // Moving the building's week once weeks are published would split them (published
    // weeks are stored by their start day), so that needs a hand from us for now.
    if (changesWeek) {
      const ScheduleWeek = require("../models/scheduleWeekModel");
      const published = await ScheduleWeek.countDocuments({ tenantId: req.tenantId, status: "published" });
      if (published) {
        return res.status(409).json({
          message: "Your schedule already has published weeks, so the building's week can't be moved here yet. Ask us and we'll move it with you. To count overtime over a different week for some roles, use role workweeks instead.",
          errorCode: "WEEK_START_LOCKED",
        });
      }
    }
    if (changesRoleWeeks) updates.roleWeekStarts = cleanRoleWeekStarts(updates.roleWeekStarts);
    // The history is ours to write, never the page's.
    delete updates.roleWeekStartsHistory;

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

    const before = cleanRoleWeekStarts(current?.roleWeekStarts);
    const change = changesRoleWeeks
      ? { at: new Date(), byId: req.user?._id || null, byName: req.user?.name || req.user?.email || "", from: before, to: updates.roleWeekStarts }
      : null;
    const prefs = await FacilityPreferences.findOneAndUpdate(
      { tenantId: req.tenantId },
      { $set: updates, ...(change ? { $push: { roleWeekStartsHistory: { $each: [change], $slice: -50 } } } : {}) },
      { new: true, upsert: true, runValidators: true },
    );
    if (change) {
      // Tell the owner and administrators (not whoever made the change), by email.
      require("../utils/workweek")
        .notifyWorkweekChange({ tenantId: req.tenantId, change, excludeUserIds: change.byId ? [change.byId] : [] })
        .catch((e) => console.error("workweek change email failed:", e.message));
    }

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
