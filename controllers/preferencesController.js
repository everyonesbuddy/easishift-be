const Preferences = require("../models/preferencesModel");
const { hasPermission } = require("../config/authorization");

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

const normalizeNullableNumber = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const pickAllowedPreferenceFields = (payload) => ({
  preferredDaysOfWeek: normalizeDayList(payload.preferredDaysOfWeek),
  avoidDaysOfWeek: normalizeDayList(payload.avoidDaysOfWeek),
  targetHoursPerWeek: normalizeNullableNumber(payload.targetHoursPerWeek),
  maxShiftsPerWeek: normalizeNullableNumber(payload.maxShiftsPerWeek),
  maxConsecutiveDays: normalizeNullableNumber(payload.maxConsecutiveDays),
  wantsOvertime:
    payload.wantsOvertime === undefined
      ? undefined
      : Boolean(payload.wantsOvertime),
  worksEveryOtherWeek:
    payload.worksEveryOtherWeek === undefined
      ? undefined
      : Boolean(payload.worksEveryOtherWeek),
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
    updates.rotationAnchorDate instanceof Date &&
    Number.isNaN(updates.rotationAnchorDate.getTime())
  ) {
    return "rotationAnchorDate must be a valid date";
  }

  // Alternation has no meaning without a starting working week.
  if (merged.worksEveryOtherWeek && !merged.rotationAnchorDate) {
    return "rotationAnchorDate is required when worksEveryOtherWeek is true";
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
