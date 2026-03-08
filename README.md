# EasiShift Backend

Multi-tenant workforce scheduling backend for care facilities and healthcare operations teams.

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

## Current Domain Model

- **Tenant**: organization account, subscription status, seat limits, billing IDs
- **User**: staff user under tenant (admin, rn, lpn, cna, caregiver, etc.)
- **Coverage**: required staffing slots by role/date/time and required headcount
- **Schedule**: assigned shifts per staff member
- **Preferences**: staff scheduling preferences and notification toggles
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
- `DELETE /api/v1/auth/:id` - delete user (admin only)

---

## API Surface

### Tenants

- `GET /api/v1/tenants` - list tenants (`superadmin`)
- `POST /api/v1/tenants` - create tenant (`superadmin`)
- `GET /api/v1/tenants/:id` - get single tenant

### Schedules

- `GET /api/v1/schedules` - list schedules (query by `staffId`, `from`, `to`)
- `POST /api/v1/schedules` - create shift
- `POST /api/v1/schedules/auto-generate` - auto-generate shifts from coverage (admin)
- `GET /api/v1/schedules/:id` - get schedule by id
- `PUT /api/v1/schedules/:id` - update schedule
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
   - filter out ineligible staff (day unavailable, call-out, overlapping time-off, overlapping shifts, short break)
   - rank eligible staff with fairness/overtime rules
   - assign the top `needed` staff

#### Fairness + Overtime Scoring

When choosing who gets assigned, candidates are ranked by:

1. **Lowest projected overtime minutes** after this assignment (above 40h/week).
2. **Lowest projected weekly minutes** in that same week.
3. **Lowest recent workload** over the last 28 days.
4. **Stable tie-breaker** to avoid always picking the same people when all metrics are equal.

This keeps assignments equitable, reduces repeatedly skipping the same person in near-tie scenarios, and avoids pushing one person close to overtime when alternatives are available.

#### Output Summary

The endpoint returns per-coverage results and an overall summary, including:

- `filled`, `partially_filled`, `skipped`, `already_filled` counts
- `alreadyAssignedCount`, `neededCount`, `unfilledCount`
- skip reasons for transparency
- notification delivery counts (email/SMS sent/failed)

### Coverage

- `GET /api/v1/coverage` - list coverage entries
- `GET /api/v1/coverage/unfilled` - unfilled coverage by role
- `GET /api/v1/coverage/unfilled-auto` - auto-generation helper data (admin)
- `POST /api/v1/coverage` - create coverage batch (admin)
- `PUT /api/v1/coverage/:id` - update coverage (admin)
- `DELETE /api/v1/coverage/:id` - delete coverage (admin)

### Time Off

- `POST /api/v1/timeoff` - request time off
- `GET /api/v1/timeoff` - list time off (admins see tenant; staff see own)
- `PATCH /api/v1/timeoff/:id/review` - approve/deny request (admin)

### Preferences

- `GET /api/v1/preferences/me` - get current user preferences
- `POST /api/v1/preferences/me` - create/update current user preferences
- `GET /api/v1/preferences/:staffId` - get staff preferences (admin)

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

- `https://easishift.com`
- `http://localhost:5173`

If your frontend runs on a different origin, update the whitelist in `app.js`.

---

## Utility Scripts

- `node scripts/migrate-tenant-defaults.js` - backfills tenant billing/default fields
- `node scripts/fixMessages.js` - schedule role migration helper for existing records

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

- This backend is now focused on workforce operations (EasiShift), not patient portal workflows.
- Use tenant-scoped queries for all protected resources.
- Keep secrets in `config.env` and never commit real credentials.
