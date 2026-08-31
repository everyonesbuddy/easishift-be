# WiserShifts Backend

Multi-tenant workforce scheduling backend for your business.

This service powers:

- tenant onboarding and staff management
- role-based authentication and authorization
- coverage planning and shift scheduling
- time-off requests and review workflows
- internal staff messaging
- admin/staff summary dashboards
- subscription billing with Stripe
- notification delivery via email and SMS

---

## Tech Stack

- Node.js + Express
- MongoDB + Mongoose
- JWT auth (Bearer token / cookie)
- Stripe (subscriptions + webhooks)
- Postmark / SMTP for email
- Twilio for SMS

---

## API Documentation

Swagger UI and raw OpenAPI JSON are now served by the backend:

- `GET /api-docs` - interactive Swagger UI
- `GET /openapi.json` - raw OpenAPI 3.0.3 document

The OpenAPI spec source is maintained in `docs/openapiSpec.js`.

---

## 2026 Scheduling Architecture Updates

The scheduling domain now uses tenant-configurable taxonomy instead of hard-coded AL/IL/MC-prefixed role enums.

- Roles are validated against `FacilityPreferences.roleFamilies` (plus system roles like `admin`).
- Coverage and schedule compatibility is enforced using role + unit area + shift type + certification tags.
- Unit areas are stored as lowercase values (normally lowercase snake_case, such as `front_office`) across facility preferences, coverage, schedules, and draft assignments.
- Compatibility semantics now distinguish explicit staff tags from floating staff:
  - staff with explicit `allowedAreas` / `allowedShiftTypes` are restricted to matching coverage tags
  - staff without explicit area/shift tags can float within compatible role coverage
- Overnight coverage is supported by normalizing `endTime <= startTime` to next-day end time.
- Coverage responses include a computed `spansOvernight` boolean.
- Coverage now enforces strict shift slot pairing: `shiftType` and `shiftTag` must be provided together (or both omitted).
- Manual coverage windows do not auto-infer `shiftType`; when using manual `startTime`/`endTime`, keep `shiftType` and `shiftTag` unset.
- Staff preferences provide soft ranking guidance for days, target workload, biweekly rotation, and overtime interest, alongside notification toggles.
- A `Schedule` can now link directly to its `Coverage` requirement through `coverageId`; schedules created from pickup and published auto-schedule drafts always carry this link.
- Coverage read endpoints compute `assignedCount` and `remaining` server-side using `coverageId`, avoiding client-side schedule/coverage joins.

---

## Current Domain Model

- **Tenant**: organization account, subscription status, seat limits, billing IDs
- **User**: tenant user with multi-role access (`roles`) and optional capability arrays (`allowedAreas`, `allowedShiftTypes`, `certificationTags`)
- **Coverage**: required staffing slots by role/date/time and required headcount
- **Schedule**: assigned shifts per staff member, optionally linked to the coverage slot it fills through `coverageId`
- **Preferences**: staff soft scheduling preferences, rotation guidance, and notification toggles
- **FacilityPreferences**: tenant-level scheduling policy and taxonomy (`roleFamilies`, `unitAreas`, `shiftTypes`, `certificationTags`)
- **TimeEntry**: tenant-scoped attendance records with clock-in/out, mode (`open`/`geofence`), and multi-break logs
- **TimeOff**: staff PTO/leave requests with admin approval flow
- **Message**: internal staff-to-staff tenant-scoped messages

All tenant data is isolated using `tenantId`.

---

## Auth + Access Control

- `authMiddleware`: verifies JWT and attaches `req.user` + `req.tenantId`
- `tenantMiddleware`: validates tenant exists and attaches `req.tenant`
- `roleMiddleware`: compatibility role checks and permission-based route restrictions

### Auth Endpoints

- `POST /api/v1/auth/signup/tenant` - create tenant + initial owner
- `POST /api/v1/auth/signup/staff` - create staff (admin only)
- `POST /api/v1/auth/login/staff` - staff/admin login
- `PATCH /api/v1/auth/change-password` - authenticated password change
- `POST /api/v1/auth/forgot-password` - issue reset token
- `POST /api/v1/auth/users/:id/send-password-reset` - send a fresh reset link for a tenant user (admin only)
- `POST /api/v1/auth/reset-password` - reset with token
- `GET /api/v1/schedules/open-for-me` - list future published open shifts compatible with the current user
- `POST /api/v1/schedules/pick-up` - claim a future open shift for the current user
- `GET /api/v1/auth/users` - list tenant users
- `GET /api/v1/auth/:id` - get user by id
- `PUT /api/v1/auth/:id` - update user
- `DELETE /api/v1/auth/:id` - delete user; use `me` to delete your own account, admins can delete other users

---

## API Surface

### Tenants

- `GET /api/v1/tenants` - list tenants (`superadmin`)
- `POST /api/v1/tenants` - create tenant (`superadmin`)
- `GET /api/v1/tenants/:id` - get single tenant
- `DELETE /api/v1/tenants/:id` - delete tenant account and all tenant data (owner for own tenant)

### Schedules

- `GET /api/v1/schedules` - list schedules (query by `staffId`, `role`, `unitArea`, `shiftType`, `status`, `from`, `to`)
- `POST /api/v1/schedules` - create shift; accepts optional `coverageId` for a shift that fills an existing coverage requirement
- `POST /api/v1/schedules/auto-generate` - auto-generate draft shifts from coverage (admin)
- `GET /api/v1/schedules/draft-schedules` - list auto-schedule drafts (admin)
- `GET /api/v1/schedules/draft-schedules/:draftId` - get one draft with assignments (admin)
- `PATCH /api/v1/schedules/draft-schedules/:draftId/assignments/:assignmentId` - edit one draft assignment (admin)
- `POST /api/v1/schedules/draft-schedules/:draftId/assignments/:assignmentId/fill-ai` - fill one draft assignment with AI-selected staff (admin)
- `POST /api/v1/schedules/draft-schedules/:draftId/publish` - publish draft assignments to schedules (admin)
- `POST /api/v1/schedules/draft-schedules/:draftId/discard` - discard a draft (admin)
- `GET /api/v1/schedules/:id` - get schedule by id
- `PUT /api/v1/schedules/:id` - update schedule
- `DELETE /api/v1/schedules/bulk` - bulk delete schedules by ids (admin)
- `DELETE /api/v1/schedules/:id` - delete schedule (admin)

### Auto-Generate Scheduling Logic (`POST /api/v1/schedules/auto-generate`)

The auto-scheduler is a rule-based engine (not a black-box model). It processes selected coverage items in chronological order using this flow:

1. It gets each selected coverage ID from `coverageIds`.
2. For each ID, it reads the coverage details (especially role, start time, end time, required headcount).
3. It finds existing schedules linked to that coverage through `coverageId`.
4. It calculates how many are still needed:
   - `needed = requiredCount - alreadyAssignedCount`
5. If `needed <= 0`, that coverage is marked already full.
6. If `needed > 0`, it moves to filtering + choosing staff:
   - filter out ineligible staff (call-out on that shift, approved overlapping time-off, overlapping shifts)
   - enforce compatibility gates (role, area, shift type/tag, certification)
   - rank eligible staff with tagged-match precedence, then fairness-first rules plus optional facility pattern guidance
   - assign the top `needed` staff

The scheduler is strictly demand-driven:

- It never creates shifts where there is no coverage demand.
- It never assigns more than `requiredCount` for a coverage item.
- If demand needs 8 people and 10 are eligible, it assigns 8 and leaves 2 unassigned based on the ranking results.

#### Draft-First Workflow

Auto-generate writes proposed assignments into `AutoScheduleDraft` first. It does not directly create `Schedule` rows.

High-level lifecycle:

1. Generate from selected `coverageIds` using `POST /api/v1/schedules/auto-generate`.
2. Receive draft metadata in response (`draftCreated`, `draftSchedule.draftId`, `draftAssignments`, `coverageResults`).
3. Review draft in UI or API (`GET /draft-schedules` and `GET /draft-schedules/:draftId`).
4. Edit assignments as needed (`PATCH /draft-schedules/:draftId/assignments/:assignmentId`):
   - reassign staff (`staffId`)
   - adjust assignment state (`proposed`, `locked`, `removed`)
   - adjust notes/window/tags (`notes`, `startTime`, `endTime`, `unitArea`, `shiftType`, `shiftTag`, `certificationTags`)
   - use `force=true` to override compatibility/conflict safeguards when intentionally needed

- fill one unfilled assignment automatically with `POST /draft-schedules/:draftId/assignments/:assignmentId/fill-ai`

5. Publish when ready (`POST /draft-schedules/:draftId/publish`) to create real `Schedule` rows.
6. Optionally discard (`POST /draft-schedules/:draftId/discard`) to retire a draft.

Per-assignment AI fill works as a targeted repair step inside an existing draft:

1. It reads the selected draft assignment as the coverage target.
2. It reuses the same compatibility gates and ranking stack as auto-generate.
3. It selects the best eligible staff member and updates the assignment in place.
4. It returns the updated assignment plus refreshed draft slot counts.

If no eligible staff remain, the endpoint returns a structured `409` response with a reason code and skip summary so the UI can explain why the slot could not be filled.

Draft statuses:

- `draft`: editable review state
- `partially_published`: some assignments published, others remain unpublished
- `published`: all publishable assignments published
- `discarded`: draft retired

Assignment states inside a draft:

- `proposed`: candidate for publish
- `locked`: candidate for publish but manually locked in draft
- `removed`: excluded from publish
- `published`: already materialized as real schedule

Publish behavior:

- By default, publish includes all unpublished `proposed`/`locked` assignments.
- You can pass `assignmentIds` to publish only selected assignments.
- Publish performs conflict checks against existing schedules; conflicts return a `blocked` list.
- Successful publish links each assignment to `publishedScheduleId` and updates draft status.

#### Demand-Driven Pattern Guidance

Facility scheduling patterns influence ranking only. They do not force assignments when there is no coverage requirement.

Pattern guidance is best understood as a tie-shaping preference layered on top of demand and fairness. The engine still prioritizes coverage fulfillment, conflict avoidance, and workload balance.

`balance` (default)

- Behavior: no additional pattern penalty.
- Example: if Monday has 5 open RN slots, the top 5 are selected by overtime, fairness, weekend/night balance, and soft preferences.
- Edge case: if all metrics are equal, stable tie-break decides.
- Recommendation: use this for most facilities unless you are intentionally trying to nudge toward a recurring cadence.

`4_on_4_off`

- Behavior: prefers assignments that continue or build contiguous multi-day blocks and penalizes isolated single-day placements.
- Example: if a staff member is already assigned Sun-Mon-Tue, assigning Wed is preferred over assigning someone with no adjacent days.
- Edge case: if demand exists only on scattered days (for example Mon/Wed/Fri), true 4-on blocks are impossible, so fairness wins and pattern influence is limited.
- Recommendation: use when your demand usually appears in multi-day runs and you want the schedule to feel block-oriented.

`2_2_3`

- Behavior: prefers short 2-3 day clusters and avoids over-fragmented single-day assignments.
- Example: assigning Tue to someone already working Mon is favored over assigning Tue to someone with no nearby days.
- Edge case: if coverage is mostly one-off days, this behaves close to balance mode.
- Recommendation: use when you want moderate block continuity without pushing long runs.

`panama`

- Behavior: similar to `2_2_3`, but with stronger pressure against stacking too many assigned days in the same week.
- Example: between two equal candidates, one projected to 4 assigned days in the week is favored over one projected to 5.
- Edge case: when shortages are high, you may still see uneven week totals because demand coverage and overlap constraints come first.
- Recommendation: use when you want rotating rhythm with controlled weekly concentration.

`fixed_5_2`

- Behavior: discourages weekend assignments and discourages projecting beyond 5 assigned days in the week.
- Example: for a Saturday shift, candidates with better weekend distribution and lower fixed-5-2 penalty rise in ranking only if still eligible.
- Edge case: if weekend coverage is mandatory and limited staff are available, weekend assignments still happen.
- Recommendation: use in weekday-primary operations where weekend work should be minimized, not eliminated.

`rotating_3`

- Behavior: prefers around 3 assigned days per week and prefers spacing instead of back-to-back days.
- Example: if a candidate is projected from 3 to 4 assigned days this week, they receive a higher pattern penalty than one projected from 1 to 2.
- Edge case: if demand is heavily concentrated on consecutive days, spacing cannot be preserved consistently.
- Recommendation: use for part-time pools or facilities targeting lower weekly day density per person.

`custom`

- Behavior: no extra pattern steering (same practical behavior as balance in current logic).
- Example: ranking proceeds by fairness stack and preferences only.
- Edge case: none specific; this is effectively an explicit opt-out of pattern nudging.
- Recommendation: use when you want full manual control of philosophy without implicit cadence assumptions.

General suggestions and edge cases

- Patterns do not create shifts. No demand means no schedule entry.
- Patterns do not guarantee perfect cycle compliance. If demand shape conflicts with pattern shape, fairness and eligibility dominate.
- Surplus staffing is expected: if demand needs 8 and 10 are eligible, 2 remain unassigned and are rotated in future runs via fairness metrics.
- Night and weekend balancing are always part of the fairness stack.

#### Fairness + Overtime Scoring

When choosing who gets assigned, candidates are ranked by:

1. **Highest tagged-match specificity** for the current coverage (explicit tag match is preferred over floating match).
2. **Lowest projected overtime minutes** after this assignment (above 40h/week).
3. **Best consecutive-day fit** under facility rules.
4. **Best scheduling-pattern fit** for the facility's selected pattern.
5. **Fairer weekend distribution** when the coverage is on a weekend.
6. **Fairer night distribution** when the coverage is a night shift.
7. **Lowest projected weekly minutes** in that same week.
8. **Lowest recent workload** over the last `fairnessLookbackDays`.
9. **Lowest preference mismatch score** from staff soft preferences.
10. **Stable tie-breaker** to avoid always picking the same people when all metrics are equal.

Overtime is treated as a ranking signal (using a configurable weekly threshold), not a hard eligibility blocker. This keeps assignments equitable and treats staff preferences as a later soft factor rather than a dominant one.

Each draft assignment includes `warnings` to support review before publish, including:

- `overtimeMinutes`
- `projectedWeekMinutes`
- `consecutiveDaysIfAssigned`
- `patternPenalty`
- `weekendShiftCount`
- `nightShiftCount`
- `preferencePenalty`

These warnings are intended to show how close an assignment is to overtime or rule pressure so schedulers can adjust before publishing.

#### Output Summary

The endpoint returns per-coverage results and an overall summary, including:

- `filled`, `partially_filled`, `skipped`, `already_filled` counts
- `alreadyAssignedCount`, `neededCount`, `unfilledCount`
- skip reasons for transparency
- `policySource` and the effective facility policy used for the run
- notification delivery counts (email/SMS sent/failed)

### Coverage

- `GET /api/v1/coverage` - list coverage entries
- `GET /api/v1/coverage/unfilled` - unfilled coverage by role
- `GET /api/v1/coverage/unfilled-auto` - auto-generation helper data (admin)
- `POST /api/v1/coverage` - create coverage batch (admin)
- `DELETE /api/v1/coverage/bulk` - bulk delete coverage by ids (admin)
- `PUT /api/v1/coverage/:id` - update coverage (admin)
- `DELETE /api/v1/coverage/:id` - delete coverage (admin)

Coverage behavior notes:

- `role` is tenant-scoped and must exist in facility `roleFamilies`.
- `unitArea`, `shiftType`, `shiftTag`, and `requiredCertificationTags` are supported for compatibility filtering.
- Compatibility rules:
  - role must match
  - if coverage is tagged, explicitly tagged staff must match those tags
  - untagged/floating staff can still match by role when they have no explicit area/shift restrictions
  - if coverage is untagged, explicitly tagged staff are not treated as floating for those tag dimensions
- Coverage can be created in two ways:
  - manual window: provide `startTime` + `endTime`
  - slot-driven window: provide `shiftType` + `shiftTag` and backend resolves UTC times from facility-local slot definitions
- `shiftType` and `shiftTag` are a strict pair. Send both together for slot-driven coverage, or omit both for manual window coverage.
- If `shiftType` + `shiftTag` are provided, slot configuration is the source of truth for `startTime`/`endTime`.
- If `shiftType` + `shiftTag` are omitted, manual `startTime`/`endTime` are used as provided.
- Overnight windows are normalized automatically when `endTime <= startTime`.
- Duplicate batch-create requests are rejected with detailed duplicate summaries.
- All coverage listing endpoints return computed `assignedCount` and `remaining` values. Counts include schedules with `scheduled`, `in_progress`, `completed`, or `left_early` status.
- `assignedCount` uses the schedule's `coverageId`, not a role/time signature. A schedule filling coverage should therefore always be created with `coverageId` or published from an auto-schedule draft.

### Time Off

- `POST /api/v1/timeoff` - request time off
- `GET /api/v1/timeoff` - list time off (admins see tenant; staff see own)
- `PATCH /api/v1/timeoff/:id/review` - approve/deny request (admin)

### Time Tracking

- `GET /api/v1/time-tracking/me` - list my time entries
- `POST /api/v1/time-tracking/clock-in` - start a time entry
- `POST /api/v1/time-tracking/breaks/start` - start a break within active entry
- `POST /api/v1/time-tracking/breaks/end` - end current break
- `POST /api/v1/time-tracking/clock-out` - finish active time entry
- `POST /api/v1/time-tracking/qr-token` - generate short-lived QR clock token (admin; QR mode only)
- `GET /api/v1/time-tracking` - list tenant time entries (admin)
- `PATCH /api/v1/time-tracking/:id/adjust` - adjust a time entry (admin)

Time tracking behavior:

- Controlled per tenant in facility preferences via `timeTracking.enabled` and `timeTracking.mode`.
- Supported modes are `open` and `qr`.
- `qr` mode requires `qrToken` on clock-in and clock-out.
- Multiple breaks are supported as a break-event array (not a single break duration field).
- Only one active entry is allowed per staff member at a time.

### Preferences

- `GET /api/v1/preferences/me` - get current user preferences
- `POST /api/v1/preferences/me` - create/update current user preferences
- `GET /api/v1/preferences/:staffId` - get staff preferences (admin)

Current staff preference fields include:

- `preferredDaysOfWeek`
- `avoidDaysOfWeek`
- `targetHoursPerWeek`
- `maxShiftsPerWeek`
- `maxConsecutiveDays`
- `wantsOvertime`
- `worksEveryOtherWeek`
- `rotationAnchorDate` (required when `worksEveryOtherWeek` is true)
- `emailNotificationsEnabled`
- `smsNotificationsEnabled`

These are soft ranking inputs used only by auto-schedule draft generation and the per-assignment AI-fill endpoint. They do not block manual schedule creation, updates, pickups, or draft publication. Role, authorized areas/shift types, certification requirements, approved time off, and scheduling conflicts remain hard rules.

`worksEveryOtherWeek` is a soft biweekly preference. When it is false, no rotation logic applies. When it is true, `rotationAnchorDate` identifies the first working week and alternate facility-local weeks receive a ranking penalty. Staff use preferred and avoided day lists for weekday/weekend choices and other fine-grained scheduling preferences; there are no separate rotation-scope or shift-type preference fields.

Recurring hard day-of-week unavailability is not stored in preferences. Hard availability blocking is handled through approved time-off requests.

### Timezone Contract

All schedule, coverage, and time-off timestamps are stored as MongoDB `Date` values: UTC instants. The database never stores a naive local time. For example, a New York `07:00` shift in daylight time is stored as `11:00:00.000Z`; during standard time, the same local `07:00` is stored as `12:00:00.000Z`. This is intentional and preserves correct ordering, duration, overlap checks, and daylight-saving transitions.

`FacilityPreferences.facilityTimezone` is the facility's IANA zone (for example, `America/New_York`). `facilityTimezoneConfirmed` is false until an administrator explicitly saves a valid zone, distinguishing the default `UTC` value from an intentional UTC choice. Facility preference writes reject invalid timezone names with `400 INVALID_TIMEZONE`.

The timezone is used in three places:

- **Slot creation:** coverage created from `shiftType` + `shiftTag` interprets slot times in the facility timezone, then stores the resulting UTC instants.
- **Calendar interpretation:** auto-schedule ranking evaluates weekday preferences, rotation parity, weeks, weekends, night shifts, consecutive days, and weekly workload in the facility timezone. This ensures a Monday 9 PM New York shift remains Monday for preference and fairness decisions even though its UTC start occurs on Tuesday.
- **Human messages:** schedule, swap, and time-off notifications render instants in the facility timezone with DST-aware abbreviations such as `EDT`, `EST`, or `CDT`.

UTC instants are used directly for sorting, duration calculations, overlap/conflict checks, and time-off conflict checks. Those calculations do not need a timezone because they compare absolute moments. The frontend should render timestamps using the confirmed facility zone and must not reinterpret a UTC instant as a naive local time.

### Facility Preferences

- `GET /api/v1/facility-preferences` - get current facility preferences (admins/owners get full config; schedulers get scheduling fields; other users get a limited view)
- `POST /api/v1/facility-preferences` - create/update facility scheduling policy (`facility_preferences.manage`)
- `DELETE /api/v1/facility-preferences/reset` - reset facility scheduling policy to defaults (`facility_preferences.manage`)

Non-admin users receive only a limited subset of facility preferences, primarily the fields needed by the UI to determine whether time tracking is available and how it behaves:

- `facilityTimezone`
- `timeTracking.enabled`
- `timeTracking.mode`
- `timeTracking.requireScheduleMatch`
- `timeTracking.clockInGraceMinutes`
- `timeTracking.clockOutGraceMinutes`
- `timeTracking.roundingMinutes`
- `timeTracking.autoCloseOpenBreakOnClockOut`

Current facility preference fields include:

- `schedulingPattern` (`balance` default)
- `weeklyOvertimeThresholdHours`
- `fairnessLookbackDays`
- `shiftReminderLeadHours`
- `notifyStaffOnCoveragePost`
- `facilityTimezone` (IANA timezone; used for local slot conversion)
- `facilityTimezoneConfirmed` (whether an admin explicitly confirmed the timezone)
- `roleFamilies`
- `unitAreas`
- `shiftTypes`
- `shiftTypeDefinitions` (multiple local-time slots per shift type, each with a `tag`)
- `certificationTags`
- `timeTracking` object:
  - `enabled`
  - `mode` (`open` or `qr`)
  - `requireScheduleMatch`
  - `clockInGraceMinutes`
  - `clockOutGraceMinutes`
  - `roundingMinutes`
  - `autoCloseOpenBreakOnClockOut`
  - `geofenceRadiusMeters`

For easier admin setup, you can store `timeTracking.geofenceAddress` as a human-readable location label. Geofence enforcement still uses `geofenceLatitude` and `geofenceLongitude` for distance checks.

### Messaging

- `GET /api/v1/messages` - list tenant messages
- `POST /api/v1/messages` - send one-to-many message(s)
- `GET /api/v1/messages/receiver/:receiverId` - inbox by receiver
- `GET /api/v1/messages/sender/:senderId` - sent messages by sender
- `PUT /api/v1/messages/:id/read` - mark read
- `DELETE /api/v1/messages/:id` - delete message

### Summary

- `GET /api/v1/summary/admin/:adminId` - admin dashboard metrics (admin)
- `GET /api/v1/summary/staff/:staffId` - staff dashboard metrics

### Billing (Stripe)

- `GET /api/v1/stripe/plans` - return the tenant-specific plan catalog, seat availability, and applicable trial duration (admin)
- `POST /api/v1/stripe/create-checkout-session` - create subscription checkout (admin)
- `POST /api/v1/stripe/change-plan` - change an existing subscription in place (admin)
- `POST /api/v1/stripe/cancel-subscription` - cancel active subscription (admin)
- `POST /api/v1/stripe/webhook` - Stripe webhook receiver (public)

Billing behavior:

- New tenants receive a one-time trial: 30 days for yearly plans and 7 days for monthly plans.
- `Tenant.trialUsedAt` prevents a tenant from receiving another trial after cancellation, resubscription, or a plan change.
- Checkout reuses the saved Stripe customer when available.
- Checkout and plan changes reject plans with fewer seats than the tenant's current user count (`409 PLAN_SEATS_BELOW_USAGE`).
- `GET /stripe/plans` returns `available`, `seatsOverLimit`, and `trialPeriodDays` for each plan so the frontend can disable invalid choices before checkout.
- Active/trialing/past-due Stripe subscriptions must use `/stripe/change-plan` instead of creating a second checkout session. Updating a subscription in place preserves any active Stripe trial end date.

---

## Background Jobs

Configured in `app.js`:

- daily reminder job at `0 8 * * *` (uses `sendPendingReminders`)
- schedule status updater every 2 hours to mark past shifts completed

---

## Environment Variables

Create `config.env` in the project root.

### Core

- `PORT` (default `5000`)
- `NODE_ENV` (`development` / `production`)
- `DB_URL` (Mongo connection string)
- `JWT_SECRET`

### Frontend / Password Reset

- `FRONTEND_URL` (used for Stripe success/cancel redirects)
- `FRONTEND_BASE_URL` (optional base URL for password reset links)
- `FRONTEND_RESET_PATH` (optional, default `/reset-password`)
- `PASSWORD_RESET_TTL_MINUTES` (optional, defaults to `20160` = 14 days)

### Stripe

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

### Email

Use Postmark (preferred):

- `POSTMARK_API_TOKEN`
- `POSTMARK_SENDER_EMAIL`

Optional SMTP fallback:

- `EMAIL_HOST`
- `EMAIL_PORT`
- `EMAIL_USER`
- `EMAIL_PASS`
- `EMAIL_SECURE` (`true`/`false`)
- `EMAIL_FALLBACK_TO_SMTP` (`true` to fallback when Postmark fails)

### SMS (Twilio)

- `TWILIO_SID`
- `TWILIO_ACCOUNT_SID` (set to same value as `TWILIO_SID` for current validation)
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

---

## Local Development

Install dependencies:

```bash
npm install
```

Run the API server:

```bash
node server.js
```

API base URL:

```text
http://localhost:5000/api/v1
```

---

## CORS Notes

Current allowed origins in `app.js`:

- `https://wisershifts.com`
- `http://localhost:5173`

If your frontend runs on a different origin, update the whitelist in `app.js`.

---

## Utility Scripts

- `node scripts/migrate-tenant-defaults.js` - backfills tenant billing/default fields
- `node scripts/fixMessages.js` - legacy helper for message/schedule role cleanup
- `node scripts/migrate-facility-taxonomy.js` - migrates legacy role prefixes, backfills facility taxonomy, and removes deprecated preference fields
- `node scripts/extend-expired-password-resets.js` - extends currently expired password reset windows by 14 days (supports `DRY_RUN=true` and optional `TENANT_ID=<id>`)
- `node scripts/normalize-coverage-shift-pairs.js` - normalizes legacy coverage rows where only one of `shiftType`/`shiftTag` is set by clearing both to manual mode (supports `DRY_RUN=true` and optional `TENANT_ID=<id>`)
- `node scripts/migrate-unit-area-lowercase.js` - normalizes uppercase legacy unit areas in coverage, schedules, draft assignments, and facility preferences
- `node scripts/backfill-schedule-coverage-id.js --dry-run` - preview links from legacy schedules to coverage requirements; rerun without `--dry-run` to write links and sync indexes
- `node scripts/backfill-tenant-trial-used.js --dry-run` - preview trial-use stamps for tenants that already had access; rerun without `--dry-run` to apply

NPM shortcuts:

- `npm run migrate:extend-expired-password-resets`
- `npm run migrate:normalize-coverage-shift-pairs`

---

## Project Structure

```text
.
├── app.js
├── server.js
├── config.env
├── controllers/
├── middleware/
├── models/
├── routes/
├── scripts/
└── utils/
```

---

## Notes

- This backend is now focused on workforce operations (Wisershifts), not patient portal workflows.
- Use tenant-scoped queries for all protected resources.
- Keep secrets in `config.env` and never commit real credentials.
