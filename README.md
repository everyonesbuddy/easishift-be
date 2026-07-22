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

## 2026 Scheduling Architecture Updates

The scheduling domain now uses tenant-configurable taxonomy instead of hard-coded AL/IL/MC-prefixed role enums.

- Roles are validated against `FacilityPreferences.roleFamilies` (plus system roles like `admin`).
- Coverage and schedule compatibility is enforced using role + unit area + shift type + certification tags.
- Compatibility semantics now distinguish explicit staff tags from floating staff:
  - staff with explicit `allowedAreas` / `allowedShiftTypes` are restricted to matching coverage tags
  - staff without explicit area/shift tags can float within compatible role coverage
- Overnight coverage is supported by normalizing `endTime <= startTime` to next-day end time.
- Coverage responses include a computed `spansOvernight` boolean.
- Coverage now enforces strict shift slot pairing: `shiftType` and `shiftTag` must be provided together (or both omitted).
- Manual coverage windows do not auto-infer `shiftType`; when using manual `startTime`/`endTime`, keep `shiftType` and `shiftTag` unset.
- Staff preferences were simplified to preferred days + notification toggles only.

---

## Current Domain Model

- **Tenant**: organization account, subscription status, seat limits, billing IDs
- **User**: staff user under tenant with dynamic role (`role`) and optional capability arrays (`allowedAreas`, `allowedShiftTypes`, `certificationTags`)
- **Coverage**: required staffing slots by role/date/time and required headcount
- **Schedule**: assigned shifts per staff member
- **Preferences**: staff preferred weekdays + notification toggles
- **FacilityPreferences**: tenant-level scheduling policy and taxonomy (`roleFamilies`, `unitAreas`, `shiftTypes`, `certificationTags`)
- **TimeOff**: staff PTO/leave requests with admin approval flow
- **Message**: internal staff-to-staff tenant-scoped messages

All tenant data is isolated using `tenantId`.

---

## Auth + Access Control

- `authMiddleware`: verifies JWT and attaches `req.user` + `req.tenantId`
- `tenantMiddleware`: validates tenant exists and attaches `req.tenant`
- `roleMiddleware`: route-level role restrictions (for example `admin`, `superadmin`)

### Auth Endpoints

- `POST /api/v1/auth/signup/tenant` - create tenant + initial admin
- `POST /api/v1/auth/signup/staff` - create staff (admin only)
- `POST /api/v1/auth/login/staff` - staff/admin login
- `PATCH /api/v1/auth/change-password` - authenticated password change
- `POST /api/v1/auth/forgot-password` - issue reset token
- `POST /api/v1/auth/reset-password` - reset with token
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
- `DELETE /api/v1/tenants/:id` - delete tenant account and all tenant data (`admin` for own tenant, `superadmin` for any tenant)

### Schedules

- `GET /api/v1/schedules` - list schedules (query by `staffId`, `from`, `to`)
- `POST /api/v1/schedules` - create shift
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
3. It finds existing schedules that match that same role + exact time window.
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

### Time Off

- `POST /api/v1/timeoff` - request time off
- `GET /api/v1/timeoff` - list time off (admins see tenant; staff see own)
- `PATCH /api/v1/timeoff/:id/review` - approve/deny request (admin)

### Preferences

- `GET /api/v1/preferences/me` - get current user preferences
- `POST /api/v1/preferences/me` - create/update current user preferences
- `GET /api/v1/preferences/:staffId` - get staff preferences (admin)

Current staff preference fields include:

- `preferredDaysOfWeek`
- `emailNotificationsEnabled`
- `smsNotificationsEnabled`

Recurring hard day-of-week unavailability is not stored in preferences. Hard availability blocking is handled through approved time-off requests.

Timezone behavior for scheduling is standardized to UTC in the backend. Any local timezone display/conversion should be handled in the frontend.

### Facility Preferences

- `GET /api/v1/facility-preferences` - get current facility scheduling policy (admin)
- `POST /api/v1/facility-preferences` - create/update facility scheduling policy (admin)
- `DELETE /api/v1/facility-preferences/reset` - reset facility scheduling policy to defaults (admin)

Current facility preference fields include:

- `schedulingPattern` (`balance` default)
- `weeklyOvertimeThresholdHours`
- `fairnessLookbackDays`
- `shiftReminderLeadHours`
- `notifyStaffOnCoveragePost`
- `facilityTimezone` (IANA timezone; used for local slot conversion)
- `roleFamilies`
- `unitAreas`
- `shiftTypes`
- `shiftTypeDefinitions` (multiple local-time slots per shift type, each with a `tag`)
- `certificationTags`

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

- `POST /api/v1/stripe/create-checkout-session` - create subscription checkout (admin)
- `POST /api/v1/stripe/cancel-subscription` - cancel active subscription (admin)
- `POST /api/v1/stripe/webhook` - Stripe webhook receiver (public)

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
