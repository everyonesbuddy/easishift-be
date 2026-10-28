const mongoose = require("mongoose");

/**
 * LaborSettings: one per workspace. What the Labor page and the Monday
 * labor email need beyond the schedule itself:
 * - pay rates (per role, with optional per-person overrides) to turn hours
 *   into dollars; only owners and admins see these
 * - the labor budget as hours per resident day (PPD) and the building's
 *   usual number of residents, with day-by-day counts where entered
 * - who gets the Monday email besides owners and admins (e.g. a regional VP
 *   who doesn't log in)
 */
const roleRateSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, lowercase: true, trim: true },
    hourlyRate: { type: Number, required: true, min: 0, max: 500 },
  },
  { _id: false },
);

const staffRateSchema = new mongoose.Schema(
  {
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    hourlyRate: { type: Number, required: true, min: 0, max: 500 },
  },
  { _id: false },
);

const censusSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    residents: { type: Number, required: true, min: 0, max: 5000 },
  },
  { _id: false },
);

const laborSettingsSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      unique: true,
    },
    payRates: { type: [roleRateSchema], default: [] },
    staffRates: { type: [staffRateSchema], default: [] },
    // Overtime is paid at this multiple of the hourly rate.
    overtimeMultiplier: { type: Number, default: 1.5, min: 1, max: 3 },
    // Budget: nursing/care hours per resident day. null = not set.
    budgetHoursPerResidentDay: { type: Number, default: null, min: 0, max: 24 },
    // Usual number of residents; used for any day without its own count.
    typicalCensus: { type: Number, default: null, min: 0, max: 5000 },
    // Day-by-day resident counts (latest ~400 days kept).
    census: { type: [censusSchema], default: [] },
    mondayReport: {
      enabled: { type: Boolean, default: true },
      // Extra people (not logged-in members), e.g. a regional VP.
      extraRecipients: { type: [String], default: [] },
      // Week start (YYYY-MM-DD) of the last week we emailed about.
      lastSentWeek: { type: String, default: null },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

module.exports = mongoose.model("LaborSettings", laborSettingsSchema);
