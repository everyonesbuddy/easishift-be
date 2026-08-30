const Preferences = require("../models/preferencesModel");
const { hasPermission } = require("../config/authorization");

const ROTATION_CADENCES = ["none", "weekly", "biweekly"];
const ROTATION_SCOPES = ["all_days", "weekends_only"];

const normalizeDayList = (value) =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((day) => Number(day))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
        ),
      )
    : undefined;

const normalizeTagList = (value) =>
  Array.isArray(value)
    ? Array.from(
        new Set(
          value
            .map((item) =>
              String(item || "")
                .trim()
                .toLowerCase(),
            )
            .filter(Boolean),
        ),
      )
    : undefined;

const normalizeNullableNumber = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const pickAllowedPreferenceFields = (payload) => ({
  preferredDaysOfWeek: normalizeDayList(payload.preferredDaysOfWeek),
  avoidDaysOfWeek: normalizeDayList(payload.avoidDaysOfWeek),
  preferredShiftTypes: normalizeTagList(payload.preferredShiftTypes),
  targetHoursPerWeek: normalizeNullableNumber(payload.targetHoursPerWeek),
  maxShiftsPerWeek: normalizeNullableNumber(payload.maxShiftsPerWeek),
  maxConsecutiveDays: normalizeNullableNumber(payload.maxConsecutiveDays),
  wantsOvertime:
    payload.wantsOvertime === undefined
      ? undefined
      : Boolean(payload.wantsOvertime),
  rotationCadence: payload.rotationCadence,
  rotationScope: payload.rotationScope,
  rotationAnchorDate:
    payload.rotationAnchorDate === undefined
      ? undefined
      : payload.rotationAnchorDate === null || payload.rotationAnchorDate === ""
        ? null
        : new Date(payload.rotationAnchorDate),
  emailNotificationsEnabled: payload.emailNotificationsEnabled,
  smsNotificationsEnabled: payload.smsNotificationsEnabled,
});

// Returns an error message, or null when the payload is acceptable.
// Takes the merged result so a previously saved value still counts.
const validatePreferenceUpdates = (updates, existing = {}) => {
  const merged = { ...existing, ...stripUndefined(updates) };

  if (
    updates.rotationCadence !== undefined &&
    !ROTATION_CADENCES.includes(updates.rotationCadence)
  ) {
    return `rotationCadence must be one of: ${ROTATION_CADENCES.join(", ")}`;
  }

  if (
    updates.rotationScope !== undefined &&
    !ROTATION_SCOPES.includes(updates.rotationScope)
  ) {
    return `rotationScope must be one of: ${ROTATION_SCOPES.join(", ")}`;
  }

  if (
    updates.rotationAnchorDate instanceof Date &&
    Number.isNaN(updates.rotationAnchorDate.getTime())
  ) {
    return "rotationAnchorDate must be a valid date";
  }

  // Parity has no meaning without an anchor week.
  if (merged.rotationCadence === "biweekly" && !merged.rotationAnchorDate) {
    return "rotationAnchorDate is required when rotationCadence is 'biweekly'";
  }

  const preferredDays = merged.preferredDaysOfWeek || [];
  const avoidedDays = merged.avoidDaysOfWeek || [];
  const overlappingDay = preferredDays.find((day) => avoidedDays.includes(day));
  if (overlappingDay !== undefined) {
    return `Day ${overlappingDay} cannot be both preferred and avoided`;
  }

  return null;
};

const stripUndefined = (payload) =>
  Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );

// STAFF: Get my preferences
exports.getMyPreferences = async (req, res, next) => {
  try {
    const prefs = await Preferences.findOne({
      staffId: req.user._id,
      tenantId: req.tenantId,
    });

    res.json(prefs || {});
  } catch (err) {
    next(err);
  }
};

// STAFF: Create or Update my preferences
exports.upsertMyPreferences = async (req, res, next) => {
  try {
    const updates = pickAllowedPreferenceFields(req.body || {});
    const existing = await Preferences.findOne({
      staffId: req.user._id,
      tenantId: req.tenantId,
    }).lean();

    const error = validatePreferenceUpdates(updates, existing || {});
    if (error) return res.status(400).json({ message: error });

    const prefs = await Preferences.findOneAndUpdate(
      { staffId: req.user._id, tenantId: req.tenantId },
      updates,
      { new: true, upsert: true, runValidators: true },
    );

    res.json(prefs);
  } catch (err) {
    next(err);
  }
};

// ADMIN: Update preferences for any staff member
exports.upsertPreferencesForStaff = async (req, res, next) => {
  try {
    const updates = pickAllowedPreferenceFields(req.body || {});
    const existing = await Preferences.findOne({
      staffId: req.params.staffId,
      tenantId: req.tenantId,
    }).lean();

    const error = validatePreferenceUpdates(updates, existing || {});
    if (error) return res.status(400).json({ message: error });

    const prefs = await Preferences.findOneAndUpdate(
      { staffId: req.params.staffId, tenantId: req.tenantId },
      updates,
      { new: true, upsert: true, runValidators: true },
    );

    res.json(prefs);
  } catch (err) {
    next(err);
  }
};

// ADMIN: View preferences for any staff member
exports.getPreferencesForStaff = async (req, res, next) => {
  try {
    if (!hasPermission(req.user, "staff.view"))
      return res.status(403).json({ message: "Admins only" });

    const prefs = await Preferences.findOne({
      staffId: req.params.staffId,
      tenantId: req.tenantId,
    });

    res.json(prefs || {});
  } catch (err) {
    next(err);
  }
};
