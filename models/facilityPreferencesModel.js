const mongoose = require("mongoose");

/**
 * FacilityPreferences — one document per tenant.
 *
 * Used by the auto-generate engine to apply facility-level scheduling
 * policy on top of individual staff preferences.
 */
const facilityPreferencesSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      unique: true, // one config per facility
      index: true,
    },

    // ─── SCHEDULING PATTERN ─────────────────────────────────────────────────
    /**
     * Scheduling style used as ranking guidance during auto-generate.
     *
     * Supported values:
     *   "balance"      — default fully fairness-based mode
     *   "4_on_4_off"   — prefers building 4-day work blocks
     *   "2_2_3"        — prefers short 2-3 day blocks
     *   "panama"       — prefers short 2-3 day blocks across a 2-week rhythm
     *   "fixed_5_2"    — prefers weekday-heavy 5-on/2-off scheduling
     *   "rotating_3"   — prefers 3 assigned days per week with spacing
     *   "custom"       — no extra pattern steering beyond fairness
     */
    schedulingPattern: {
      type: String,
      enum: [
        "balance",
        "4_on_4_off",
        "2_2_3",
        "panama",
        "fixed_5_2",
        "rotating_3",
        "custom",
      ],
      default: "balance",
    },

    // ─── WORKLOAD SIGNALS ────────────────────────────────────────────────────
    /**
     * Weekly hour threshold used to start flagging projected overtime
     * in ranking metrics (not a hard assignment blocker).
     */
    weeklyOvertimeThresholdHours: {
      type: Number,
      default: 40,
      min: 1,
    },

    // ─── FAIRNESS & DISTRIBUTION ─────────────────────────────────────────────
    /**
     * How many days back to look when calculating recent workload fairness.
     * Higher = more historical context; lower = more responsive to recent changes.
     */
    fairnessLookbackDays: {
      type: Number,
      default: 28,
      min: 7,
      max: 90,
    },

    // ─── NOTIFICATIONS ───────────────────────────────────────────────────────
    /**
     * How many hours before a shift starts that staff receive a reminder.
     */
    shiftReminderLeadHours: {
      type: Number,
      default: 24,
      min: 1,
    },

    /**
     * Whether the facility wants staff notified when a new open coverage
     * slot is posted (opt-in broadcast).
     */
    notifyStaffOnCoveragePost: {
      type: Boolean,
      default: false,
    },

    // ─── FACILITY TAXONOMY ──────────────────────────────────────────────────
    /**
     * Role families the facility uses. Keep these as base roles only
     * (for example, receptionist instead of al_receptionist).
     */
    roleFamilies: {
      type: [String],
      default: [],
    },

    /**
     * Facility areas / units such as AL, IL, MC, or tenant-defined units.
     */
    unitAreas: {
      type: [String],
      default: ["AL", "IL", "MC"],
    },

    /**
     * Shift types used by the facility. Default day/evening/night, but the
     * admin can add more custom shift buckets.
     */
    shiftTypes: {
      type: [String],
      default: ["day", "evening", "night"],
    },

    /**
     * Certification / skill tags available in this tenant.
     */
    certificationTags: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "FacilityPreferences",
  facilityPreferencesSchema,
);
