const Preferences = require("../models/preferencesModel");

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
    const prefs = await Preferences.findOneAndUpdate(
      { staffId: req.user._id, tenantId: req.tenantId },
      { ...req.body },
      { new: true, upsert: true }
    );

    res.json(prefs);
  } catch (err) {
    next(err);
  }
};

// ADMIN: View preferences for any staff member
exports.getPreferencesForStaff = async (req, res, next) => {
  try {
    if (req.user.role !== "admin")
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
