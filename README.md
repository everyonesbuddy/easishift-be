# WiserShifts Backend

Scheduling for care facilities: assisted living, memory care, skilled nursing and home care.

**One scheduler signs up free, builds the week from a staffing template, and publishes it. Every staff member gets one text or email with a personal link.** Staff never download an app or create an account; they use their link to see shifts, swap, pick up open shifts, call out and request time off.

Node.js + Express · MongoDB + Mongoose · Stripe · Postmark/SMTP · Twilio · Luxon

- Interactive API docs: `GET /api-docs` (raw: `GET /openapi.json`, source: `docs/openapiSpec.js`)
- Product direction and change plan: `docs/PIVOT_PLAN.md`

---

## How it works

### People
| Kind | `User.loginEnabled` | Roles | Signs in with |
|---|---|---|---|
| **Accounts** | `true` | `owner` (one per workspace), `scheduler`, `viewer` (read-only, free) | email + password (JWT) |
| **Staff contacts** | `false` | facility roles only: `cna`, `rn`, `caregiver`, … | their personal link `/s/<token>` |

- Staff need a name plus a phone **or** an email.
- Phone numbers are stored in E.164 (`phoneE164`).
- Contacts are unique per workspace by phone/email, so the same nurse can work at two facilities.
- `admin` is a legacy alias of `scheduler`.

### Plans (`config/plans.js`)
| Plan | Schedulers | Staff | Adds |
|---|---|---|---|
| Free | 1 | 15 | email notifications |
| Pro ($49/mo, $490/yr) | 3 | 75 | texting, swaps, open-shift pickup, call-out texts, CSV import, reminders |
| Facility ($179/mo, $1,790/yr) | 10 | 200 | auto-fill, time clock, timesheets & payroll export, messaging, dashboard |
| Organization (custom) | ∞ | ∞ | white-label branding |

- Everyone starts on **Free**. The owner can start a one-time, no-card **14-day Pro trial** (`POST /billing/start-trial`).
- `getEffectivePlanKey(tenant)` picks the plan in this order: paid plan in good standing → active trial → Free.
- Plan errors are **402**:
  - `PLAN_FEATURE_REQUIRED`: the feature isn't on your plan.
  - `PLAN_LIMIT_REACHED`: adding staff/schedulers past the limit.
  - `OVER_PLAN_LIMIT`: publishing while over the limit, e.g. after a trial ends.
  - Each includes `trialAvailable` so the app can offer the trial.
- Over the limit, nothing is deleted. Publishing new weeks and adding people are blocked until the owner upgrades or archives staff.

### Building a week
1. **Onboarding:**
   - `POST /auth/signup` creates the workspace and owner.
   - `POST /setup/facility-type` applies a preset from `config/facilityPresets.js`: roles, shift times and a starting **staffing template**.
   - `PUT /staffing-template` saves the needs.
   - `POST /staff/bulk` adds staff.
   - `POST /setup/complete` finishes.
2. **The staffing template** (`StaffingTemplate`) says how many of each role every shift needs on each weekday (`countsByWeekday`, Sunday = 0).
3. **`GET /weeks/:weekStart`** (`YYYY-MM-DD`, the facility's first weekday):
   - The first time a week is opened, its `Coverage` rows (one per day/shift/role with `requiredCount`) are created from the template.
   - Returns everything the schedule screen needs: coverage with `assignedCount`/`remaining`, shifts, staff, time off and counts.
4. **Edit one day** with `PUT /coverage/:id`. That marks the row `overridden`, so later template changes leave it alone.
5. **Assign** with `POST /schedules`; `GET /weeks/:weekStart/candidates?coverageId=` lists who can take a slot and why others can't. Assignments in an unpublished week are **drafts** (`Schedule.state = "draft"`) and send nothing.
6. **Publish** with `POST /weeks/:weekStart/publish`:
   - Drafts go live and each person gets **one** text or email listing their shifts, plus their link.
   - It returns who wasn't reached and why.
   - Publishing again only messages people whose shifts changed.
   - After publishing, edits notify just the affected person (send `notify: false` for a quiet edit).

### Staff links (`/api/v1/s/:token/...`)
- Every staff contact has one permanent link. The 256-bit token is stored as SHA-256 for lookup plus an AES-256-GCM copy (`STAFF_LINK_KEY`) so it can be re-sent.
- `middleware/staffLinkMiddleware.js` turns the token into `req.user` / `req.tenantId` / `req.plan` with staff permissions only, so the normal controllers serve link requests unchanged.
- Links are revoked on archive and can be rotated (`POST /staff/:id/rotate-link`).

### Notifications (`utils/notify.js`)
| Situation | Channel |
|---|---|
| Pro+, has a phone, opted in to texts | SMS |
| otherwise, has email | email |
| Pro+, phone, hasn't answered yet | one opt-in text ("Reply START…") |
| Free with phone only / opted out / no contact | not reached (`sms_needs_pro`, `opted_out`, `no_contact`) |

Every send is logged in `OutboundMessage`. Schedulers get email (`notifySchedulers`).

### Texting (`POST /sms/inbound`, Twilio webhook)
- `START` opts in and replies with their link; `STOP`-family opts out; `HELP` replies with help.
- `YES` takes the open call-out shift we texted them about.
- **Call-outs:**
  - `POST /schedules/:id/call-out` marks someone out and returns who can cover.
  - `POST /coverage/:id/fill-by-text` texts eligible staff. It skips people the shift would push into overtime, and the first YES wins.
  - Everyone else is told it's filled, and schedulers are emailed.
- Pickups and YES replies share `claimCoverage`, which re-counts after creating the shift so a slot can't be overfilled even when two people answer at once.

### Background jobs (`app.js`)
| When | Job |
|---|---|
| hourly at :05 | shift reminders (`utils/reminderJobs.js`, Pro+) |
| daily 14:00 UTC | trial ending / ended emails (`utils/trialJobs.js`) |
| every 2 hours | close out past shifts (`completed`, or `no_show` when the time clock is on) |

### Timezones
- Every instant (`startTime`, `endTime`, `clockInAt`, …) is a UTC `Date`. Calendar days (`Coverage.date`, `ScheduleWeek.weekStart`) are the facility-local day stored at `00:00Z`.
- `FacilityPreferences.facilityTimezone` (IANA, e.g. `America/New_York`) is used to turn shift times into instants, to work out weeks, and to format messages. `utils/dateUtils.js` holds the helpers.

### Auto-fill (Facility plan)
`POST /schedules/auto-generate` with coverage ids builds a draft using role/area/shift/certification compatibility, time off, conflicts, staff preferences, the facility's scheduling pattern, fairness and overtime. Publishing a draft puts the shifts on the schedule; they stay silent drafts until the week is published.

---

## Project structure
```
config/        plans.js, facilityPresets.js, authorization.js (roles → permissions)
controllers/   one per area (auth, staff, member, setup, week, staffingTemplate,
               coverage, schedule, callout, staffPortal, sms, stripe, …)
middleware/    authMiddleware (JWT), tenantMiddleware (+ plan), staffLinkMiddleware,
               roleMiddleware (requirePermission), planMiddleware (requireFeature)
models/        Tenant, User, FacilityPreferences, StaffingTemplate, ScheduleWeek,
               Coverage, Schedule, ShiftSwap, TimeOff, Preferences, TimeEntry,
               StaffLink, CalloutOffer, OutboundMessage, Message, AutoScheduleDraft, TenantAsset
routes/        mounted under /api/v1 in app.js
utils/         notify, staffLinks, weekService, dateUtils, eligibility, callouts,
               planLimits, phone, passwordLinks, reminderJobs, trialJobs, sendEmail, sendSMS, …
docs/          openapiSpec.js (API docs), PIVOT_PLAN.md
tests/         node:test unit tests (npm test)
```

---

## Running locally
```bash
npm install
cp config.env.example config.env   # or create config.env (see below)
npm start                          # node server.js
npm test                           # node --test tests/*.test.js
```
`tests/openapiCoverage.test.js` fails if a route is added without documenting it in `docs/openapiSpec.js`.

## Environment variables (`config.env`)
| Variable | Required | Notes |
|---|---|---|
| `DB_URL` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | signs account sessions |
| `STAFF_LINK_KEY` | yes | 64 hex chars; the server won't start without it. **Never change it** once links exist. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `FRONTEND_URL` | yes | e.g. `https://app.wisershifts.com`; used in staff links, password links, Stripe redirects |
| `API_PUBLIC_URL` | yes for Twilio | public base URL of this API (Twilio signature checks depend on it exactly) |
| `ALLOWED_ORIGINS` | no | comma-separated CORS origins |
| `PORT`, `NODE_ENV` | no | |
| `FRONTEND_RESET_PATH` | no | default `/reset-password` |
| `PASSWORD_SETUP_TTL_MINUTES`, `PASSWORD_RESET_TTL_MINUTES` | no | invite / reset link lifetimes |
| `DEFAULT_COUNTRY_CODE` | no | for phone numbers typed without one; default `+1` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | yes for billing | |
| `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_FACILITY_MONTHLY`, `STRIPE_PRICE_FACILITY_YEARLY` | yes for billing | Stripe **Price IDs** |
| `STRIPE_FOUNDING_COUPON_ID` | no | $20-off-forever coupon applied to the first 20 Pro monthly checkouts |
| `POSTMARK_API_TOKEN`, `POSTMARK_SENDER_EMAIL` | yes for email | or SMTP: `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_SECURE`, `EMAIL_FALLBACK_TO_SMTP` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | yes for texting | |
| `TWILIO_MESSAGING_SERVICE_SID` | recommended | A2P 10DLC messaging service (else `TWILIO_PHONE_NUMBER`) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | no | AI form parsing / AI fill |

No longer used: `TWILIO_SID`, `TENANT_ROOT_DOMAIN`, `TENANT_APP_URL_SCHEME`, `TENANT_APP_URL_PORT`, `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`, `FRONTEND_BASE_URL`.

## Going live checklist
1. **Database:** start from an empty database (the data model changed; there are no migrations).
2. **Env:** set `STAFF_LINK_KEY`, `FRONTEND_URL`, `API_PUBLIC_URL`, and rename `TWILIO_SID` → `TWILIO_ACCOUNT_SID`.
3. **Stripe:**
   - Create the Pro and Facility prices (monthly + yearly) and set the four `STRIPE_PRICE_*` IDs.
   - Optionally add the founding coupon.
   - Enable the customer portal.
   - Webhook events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
4. **Twilio:**
   - Register an A2P 10DLC brand and campaign, using `optInText` in `utils/notify.js` as the sample message.
   - Create a Messaging Service (`TWILIO_MESSAGING_SERVICE_SID`).
   - Point incoming messages to `POST {API_PUBLIC_URL}/api/v1/sms/inbound`.
5. **Frontend:** serve the staff page at `/s/:token`.
