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
     * The rotation pattern the facility uses.
     *
     * Supported values:
     *   "4_on_4_off"   — 4 consecutive working days, 4 days off (default)
     *   "2_2_3"        — rotating 2-on/2-off/3-on (Pitman variant)
     *   "panama"       — 2-on/2-off/3-on/2-on/2-off/3-on (28-day cycle)
     *   "fixed_5_2"    — standard Mon-Fri, fixed weekends off
     *   "rotating_3"   — 3 shifts per week, rotating days
     *   "custom"       — no enforced pattern; purely coverage-driven
     */
    schedulingPattern: {
      type: String,
      enum: [
        "4_on_4_off",
        "2_2_3",
        "panama",
        "fixed_5_2",
        "rotating_3",
        "custom",
      ],
      default: "4_on_4_off",
    },

    // ─── WORKLOAD LIMITS ─────────────────────────────────────────────────────
    /**
     * Maximum consecutive working days before a staff member must have a day off.
     * Auto-generate will skip staff who would exceed this if assigned.
     */
    maxConsecutiveWorkDays: {
      type: Number,
      default: 4,
      min: 1,
      max: 14,
    },

    /**
     * Facility-level default weekly hour cap (overridden by staff's own
     * maxHoursPerWeek if set and lower).
     */
    defaultMaxHoursPerWeek: {
      type: Number,
      default: 40,
      min: 1,
    },

    /**
     * Minimum rest hours required between the end of one shift and the
     * start of the next for the same staff member.
     */
    minRestHoursBetweenShifts: {
      type: Number,
      default: 8,
      min: 0,
    },

    // ─── FAIRNESS & DISTRIBUTION ─────────────────────────────────────────────
    /**
     * Whether auto-generate should try to distribute weekend shifts
     * evenly across staff rather than purely by workload score.
     */
    evenWeekendDistribution: {
      type: Boolean,
      default: true,
    },

    /**
     * Whether auto-generate should try to distribute night shifts
     * evenly across staff.
     */
    evenNightDistribution: {
      type: Boolean,
      default: true,
    },

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

    // ─── STAFF PREFERENCE WEIGHT ─────────────────────────────────────────────
    /**
     * How strongly staff scheduling preferences (preferred days, shift times,
     * dislikes nights) influence auto-generate assignment ranking.
     *
     *   "strict"   — preference mismatches are near-disqualifying
     *   "balanced" — preferences are a meaningful but not dominant factor (default)
     *   "loose"    — preferences are a tiebreaker only; workload fairness dominates
     */
    staffPreferenceWeight: {
      type: String,
      enum: ["strict", "balanced", "loose"],
      default: "balanced",
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
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "FacilityPreferences",
  facilityPreferencesSchema,
);
