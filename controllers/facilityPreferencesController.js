const FacilityPreferences = require("../models/facilityPreferencesModel");

// ADMIN: Get this facility's preferences (create defaults if none exist yet)
exports.getFacilityPreferences = async (req, res, next) => {
  try {
    let prefs = await FacilityPreferences.findOne({ tenantId: req.tenantId });

    if (!prefs) {
      // Return schema defaults without persisting — let the admin decide when to save
      prefs = new FacilityPreferences({ tenantId: req.tenantId });
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
