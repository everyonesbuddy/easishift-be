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
| **Accounts** (team members) | `true` | `owner` (one per workspace), `administrator`, `scheduler`, `viewer` (read-only, free) | email + password (JWT) |
| **Staff contacts** | `false` | facility roles only: `cna`, `rn`, `caregiver`, … | their personal link `/s/<token>` |

- Staff need a name plus a phone **or** an email.
- Phone numbers are stored in E.164 (`phoneE164`).
- Contacts are unique per workspace by phone/email, so the same nurse can work at two facilities.
- `admin` is a legacy alias of `scheduler`.
- **Managers** = owner, administrators and schedulers (`utils/schedulers.js`). They get the alerts, the morning summary and the next-step nudges (below).
- Team members can have a phone too (Members page: invite, **Edit**, or `PATCH /members/me` for yourself). It's only used to text them alerts.

### Plans (`config/plans.js`)
| Plan | Monthly | Yearly | Active staff | Schedulers | Support |
|---|---|---|---|---|---|
| Free | $0 | – | 15 | 1 | help docs |
| Starter | $500 | $4,800 | 50 | 3 | standard |
| Growth | $800 | $7,700 | 100 | 5 | standard |
| Premium | $1,000 | $9,600 | 150 | 10 | priority |
| Enterprise | custom | custom annual | unlimited | unlimited | priority |

- **Free** has the core: Weekly Needs, the week schedule, areas and certifications, staff directory, publish by email, staff links and time off.
- **Starter, Growth and Premium** have the same features: texting, swaps, open-shift pickup, call-outs by text, CSV import, reminders, automated scheduling, time clock, timesheets and payroll export, messaging and the dashboard. They differ by size and support.
- **Enterprise** adds branding and multiple facilities, and is sales-led (not sold through checkout).
- Viewers (read-only accounts) are always free.

**Trials**
- In the app, the owner can start a one-time, no-card **14-day Starter trial** (`POST /billing/start-trial`).
- The first Stripe checkout gets a card trial: **7 days monthly, 30 days yearly**. It's skipped if the workspace already had the in-app trial.

**Effective plan:** `getEffectivePlanKey(tenant)` picks, in order: a paid plan in good standing, then an active trial, then Free. Older keys (`pro`, `facility`, `organization`) read as Starter, Growth and Enterprise.

**Plan errors are 402:**
- `PLAN_FEATURE_REQUIRED`: the feature isn't on your plan.
- `PLAN_LIMIT_REACHED`: adding staff or schedulers past the limit.
- `OVER_PLAN_LIMIT`: publishing while over the limit.
- `SCHEDULER_READ_ONLY`: see below.
- Each includes `trialAvailable` so the app can offer the trial.

**When a trial ends (or a plan is cancelled) over the limits:**
- **Nothing is deleted.** Published weeks and staff links keep working.
- **One grace week:** within 14 days of the trial ending, one week can still be published (and re-sent). `GET /auth/me` returns `grace`.
- **Read-only schedulers:** while over the scheduler limit, schedulers other than the owner can look but not change anything (`readOnlyReason` in `/auth/me`; 402 `SCHEDULER_READ_ONLY` on changes).
- **Paused:** adding people and publishing further weeks, until the owner upgrades or runs **`POST /billing/fit-to-plan`**. That picks which staff stay active (the rest are archived and can be restored) and which schedulers stay (the rest become viewers).

### Building a week
1. **Onboarding:**
   - `POST /auth/signup` creates the workspace and owner.
   - `POST /setup/facility-type` applies a preset from `config/facilityPresets.js`: roles, shift times and a starting **staffing template**.
   - `PUT /staffing-template` saves the needs.
   - `POST /staff/bulk` adds staff.
   - `POST /setup/complete` finishes.
2. **Weekly Needs** (`StaffingTemplate`, one per workspace) says how many of each role every shift needs on each weekday (`countsByWeekday`, Sunday = 0).
   - A rule can also name a unit area and required certifications, e.g. "2 caregivers with Med Pass in Memory Care". These must exist in facility preferences, and are stored lowercase.
   - The same shift and role can appear once per area.
3. **`GET /weeks/:weekStart`** (`YYYY-MM-DD`, the facility's first weekday):
   - The first time a week is opened, its `Coverage` rows (one per day/shift/role with `requiredCount`) are created from the template.
   - Returns everything the schedule screen needs: coverage with `assignedCount`/`remaining`, shifts, staff, time off and counts.
4. **Edit one day:**
   - `PUT /coverage/:id` changes a slot.
   - `POST /weeks/:weekStart/slots` adds a one-off need.
   - Both mark the row `overridden`, so later Weekly Needs changes leave it alone.
   - `GET /weeks?from=&to=` opens every week in a range (up to 8). The month and roster views use it so slots exist whatever view is opened.
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

### Messages: text or email
Every message goes through `sendToStaff` in `utils/notify.js` (managers too, via `alertManagers` in `utils/managerAlerts.js`), which picks the channel:

| Situation | What happens |
|---|---|
| Texting plan, has a phone, said yes to texts, under the monthly cap, and the message has a text version | **Text** |
| Otherwise, has an email | **Email** |
| Texting plan, has a phone, hasn't answered yet | Email (if any), plus **one opt-in text** asking them to reply START |
| Free plan with only a phone, said STOP, or no phone and no email | Not reached (`sms_needs_upgrade`, `opted_out`, `no_contact`) |

Some messages are email-only on purpose (no text version), to save texts. See **When we text and when we email** below.

**Saying yes to texts (`User.smsConsent`)**
- `status`: `none` → `pending` (we sent the opt-in text) → `opted_in` or `opted_out`.
- `method`: `reply` (they texted START or YES) or `in_app` (a team member added **their own** number and ticked "Text me…"; they get a confirmation text).
- Nobody can say yes for someone else. A number an owner types in for someone gets the opt-in text, and they reply.
- Staff and managers get different opt-in wording: `optInText` and `managerOptInText`.
- A new phone number starts over at `none`.

**Keeping texts cheap**
- **Plain characters only** (`utils/smsText.js`): one `–`, `·`, curly quote or emoji makes the whole text cost per 70 characters instead of 160. `sendSMS` swaps them for plain ones (`7a-3p`), keeps accents GSM supports, drops the rest, and counts segments.
- **Monthly cap per workspace:** `SMS_MONTHLY_SEGMENT_CAP` segments (default 4000; `0` = no cap). Over it, messages go by email until the month turns over.
- **Call-out offers go in waves** and **reminders are smart** (below).
- Every send is logged in `OutboundMessage` (kind, channel, status, segments). HQ → Customer messages shows texting this month and its estimated cost (`SMS_COST_PER_SEGMENT`).

### When we text and when we email
| Message | Who | Text when | Otherwise |
|---|---|---|---|
| Schedule published (`week_published`) | each staff member on it | always (one per person, all their shifts and their link) | email |
| Changes to a published week (`shift_added/changed/removed`) | the people affected | always, once the scheduler presses **Send changes** (edits wait and go out together) | email |
| Shift reminder (`reminder`) | staff | paid plans. **Smart** (default): only the first shift back after a day off. Or every shift, or off (Settings → Notifications) | email |
| Open-shift offer (`callout_offer`) | eligible staff, not into overtime | always, **in waves**: the 5 most likely to say yes first, then 5 more every 10 minutes while it's open. All at once if it starts within 3 hours, or the scheduler picks people or **Text everyone now** | email |
| "It's filled" (`callout_filled`) | people who were texted the offer | always | none |
| Time-off answer (`timeoff`) | the staff member | always | email |
| Staff link re-sent (`link`) | the staff member | always | email |
| Call-out alert (`callout_alert`) | managers | the shift starts within 24 hours | email |
| Time-off request (`timeoff_alert`) | managers | never | email (the morning summary also lists waiting requests) |
| Morning summary, 6 a.m. (`morning_summary`) | managers | something needs them (an open slot, an uncovered call-out, a request, a next step) | email; skipped on quiet days |
| Next-step nudge, 10 a.m. Mon/Wed/Fri (`morning_summary`) | managers | only "publish next week" | email |
| "Someone took the shift", time-off and swap notices, trial and billing emails, the Monday labor email | owners / managers | never | email |
| Opt-in text (`opt_in`) | anyone with a phone who hasn't answered | once (again only from HQ's button) | none |

HQ → Settings → **Customer messages** sends the morning summary, a nudge, a sample call-out alert or the opt-in text to a workspace's managers on demand. Those test sends always text when they can.

### Texting replies (`POST /sms/inbound`, Twilio webhook)
- Matches the sender to **any active person with that phone**: staff and team members.
- `START` (or `YES` with no offer waiting) opts in. `STOP`-family opts out. `HELP` replies with help.
- `YES` takes the open shift **we offered them**. Someone in a later wave who hasn't been sent the offer can't claim it.
- Without this webhook set on the Twilio number, no replies reach the app: no opt-ins, no STOPs, no YES to shifts.

**Call-outs**
- `POST /schedules/:id/call-out` marks someone out and returns who can cover.
- When staff call out themselves (their link or a text), managers get the call-out alert with a **Fill it** link to `/schedule?callout=<id>`, plus how many can cover without overtime.
- `POST /coverage/:id/fill-by-text`:
  - ranks eligible staff with `rankForOffer`: their yes-rate on past offers, then fewest hours this week;
  - skips anyone it would put into overtime;
  - sends the first wave. `sendNextWaves` sends the rest only while the shift is still open, rechecking eligibility each time.
- The first YES wins. Pickups and YES replies share `claimCoverage`, which re-counts after creating the shift, so a slot can't be overfilled even when two people answer at once.

### Managers' alerts, morning summary and nudges
- **Alerts** (`utils/managerAlerts.js`) go to every manager with a login: call-outs and time-off requests, by the rules above.
- **Morning summary** (`utils/morningSummary.js` builds it, `utils/morningSummaryJobs.js` sends it):
  - **When:** 6 a.m. facility time.
  - **What:** today's shifts, slots still open, call-outs in the last 24 hours and who's covering, time-off and swaps waiting, who's at or over the overtime line this week, and the **next step**.
  - **Once a day per workspace:** `ManagerDigest` is claimed before sending.
  - **Off switch:** `Preferences.morningSummaryEnabled` (Staff → Edit → Morning summary).
- **Next step** (`utils/setupNudge.js`): the one thing the workspace should do next, earliest first:
  1. finish setup
  2. add staff
  3. add phone numbers
  4. publish the schedule
  5. publish next week (from Thursday)
  6. get staff to say yes to texts (when under half have)
  - The first two stop 45 days after signup.
  - On quiet days the step goes out on its own at **10 a.m. on Mondays, Wednesdays and Fridays**.

### Background jobs (`app.js`)
| When | Job |
|---|---|
| every 5 minutes | next wave of open-shift offers, while still open (`utils/callouts.js` `sendNextWaves`) |
| hourly at :05 | shift reminders, paid plans, smart by default (`utils/reminderJobs.js`) |
| hourly at :10 | managers' morning summary at 6 a.m. facility time; next-step nudges at 10 a.m. Mon/Wed/Fri (`utils/morningSummaryJobs.js`) |
| hourly at :20 | Monday labor email, 7 a.m. local on Mondays (`utils/laborReportJobs.js`, paid plans) |
| hourly at :40 | HQ: email signals from Klaviyo (no-op without `KLAVIYO_PRIVATE_KEY`) |
| daily 11:35 UTC | HQ: new federal listings from SAM.gov (no-op without `SAM_GOV_API_KEY`) |
| every 2 hours | close out past shifts (`completed`, or `no_show` when the time clock is on) |
| daily 14:00 UTC | trial ending / ended emails (`utils/trialJobs.js`) |

**Testing locally against the live database:** these jobs send real messages to real customers while your local server runs.

### Workweeks (`utils/workweek.js`)
- **The building's week** (`FacilityPreferences.weekStartsOn`, Sunday by default) lays out and publishes the schedule, and is the overtime week for everyone by default.
- **Role workweeks** (`roleWeekStarts`): some roles can count overtime over a different 7 days, e.g. `[{ roles: ["cook", "server"], weekStartsOn: 4 }]` for dining Thursday to Wednesday.
  - The overtime law allows different workweeks for different groups of employees.
  - The schedule screen still shows the building's week. Only hours and overtime follow each person's own week.
- **Where each person's own week is used:**
  - the call-out overtime check
  - the "who can cover" and fill lists
  - auto-fill
  - the labor report, the Monday email and the overtime fix list
  - the morning summary's overtime line
- **Who can change it:**
  - **Role workweeks:** anyone who manages settings, schedulers included. Every change is recorded in `roleWeekStartsHistory` (who, when, before and after; the last 50 are kept) and emailed to the owner and administrators.
  - **The building's week:** owners and administrators only (`tenant.settings`).
- **Moving the building's week once weeks are published is blocked** (409 `WEEK_START_LOCKED`), because published weeks are stored by their start day and would split.

### Timezones
- Every instant (`startTime`, `endTime`, `clockInAt`, …) is a UTC `Date`. Calendar days (`Coverage.date`, `ScheduleWeek.weekStart`) are the facility-local day stored at `00:00Z`.
- `FacilityPreferences.facilityTimezone` (IANA, e.g. `America/New_York`) is used to turn shift times into instants, to work out weeks, and to format messages. `utils/dateUtils.js` holds the helpers.

### Auto-fill (Facility plan)
`POST /schedules/auto-generate` with coverage ids builds a draft using role/area/shift/certification compatibility, time off, conflicts, staff preferences, the facility's scheduling pattern, fairness and overtime. Publishing a draft puts the shifts on the schedule; they stay silent drafts until the week is published.

### HQ (WiserShifts' own back office, `/api/v1/hq/...`)
- **Who:** WiserShifts' own team, separate from workspace accounts. It has its own sign-in (`HqUser`, `HQ_JWT_SECRET`). Create a user with `node scripts/create-hq-user.js`.
- **What's in it** (controllers `hq*Controller.js`, helpers `utils/hq/`):
  - **This week and History:** the weekly to-do list from the campaigns, ticked off with outcomes, and a look back at any period.
  - **Campaigns (playbook):** scripts and templates. Seeded and versioned in `hqPlaybookController.js` (`SEED_VERSION`); your edits are never overwritten.
  - **Facilities, contacts and Facebook:** the facilities and people we reach out to, and Facebook groups.
  - **Content calendar and blog:** the blog reads Contentful.
  - **Results:** signups, funnel, web and search (GA4, Search Console, YouTube), email (Klaviyo).
  - **Money:** profit and loss from Stripe (read only) plus expenses, and failed-payment nudges.
  - **Customer success** (`hqSuccessController.js`, `utils/hq/success.js`):
    - **Who's on it:** every paying workspace is added automatically, and you can add trials or pilots by hand.
    - **Health:** green, yellow or red, with the reasons in plain words.
      - **Red:** a failed payment, this week not published, or no manager login for 10 days.
      - **Yellow:** next week not published by Thursday, few phones or text opt-ins, quiet managers, or staff not opening their schedules.
    - **Checklists by stage:** onboarding (several items tick themselves from the data), running smoothly, at risk and renewal.
    - **Check-ins:** a call, visit or meeting sets the next one (weekly for 90 days, then every two weeks; every 3 days when at risk). Due check-ins and red customers show in This week.
  - **Government contracts:**
    - **Federal listings:** pulled from SAM.gov daily (`utils/hq/samGov.js`). The search covers our software industry codes, plus titles about scheduling, workforce management and timekeeping, filtered to ones about scheduling people.
    - **State, county and city listings:** added by hand.
    - **Tracking:** each listing goes new → reviewing → bidding (with a checklist) → submitted → won or lost.
    - **Deadlines:** questions and responses due soon show at the top of This week.
  - **Customer messages:** test sends, and texting cost.
  - **Connections:** Google Sheets sync and backups.

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
               StaffLink, CalloutOffer, OutboundMessage, ManagerDigest, Message,
               AutoScheduleDraft, TenantAsset, and the Hq* models for HQ
routes/        mounted under /api/v1 in app.js
utils/         notify, managerAlerts, morningSummary(+Jobs), setupNudge, smsText,
               staffLinks, weekService, dateUtils, eligibility, callouts, planLimits,
               phone, passwordLinks, reminderJobs, laborReport(+Jobs), trialJobs,
               sendEmail, sendSMS, …
utils/hq/      HQ helpers (week plan, playbook versions, money, blog, Klaviyo, Google, …)
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

**`config.env` tip:** wrap values in double quotes, e.g. `DB_URL="mongodb+srv://..."`. dotenv treats an unquoted `#` as the start of a comment, so a password with `#` gets cut off (the error is "mongodb+srv URI cannot have port number"). dotenv also never overrides a variable that's already set in your shell or Windows environment.

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
| `STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_STARTER_YEARLY`, `STRIPE_PRICE_GROWTH_MONTHLY`, `STRIPE_PRICE_GROWTH_YEARLY`, `STRIPE_PRICE_PREMIUM_MONTHLY`, `STRIPE_PRICE_PREMIUM_YEARLY` | no | Only if you'd rather use Prices made in the Stripe dashboard. Without them, checkout charges the amounts in `config/plans.js` (`PLAN_PRICES`) directly. |
| `POSTMARK_API_TOKEN`, `POSTMARK_SENDER_EMAIL` | yes for email | or SMTP: `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_SECURE`, `EMAIL_FALLBACK_TO_SMTP` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | yes for texting | |
| `TWILIO_MESSAGING_SERVICE_SID` | recommended | A2P 10DLC messaging service (else `TWILIO_PHONE_NUMBER`) |
| `TWILIO_PHONE_NUMBER` | if no messaging service | the number texts come from |
| `SMS_MONTHLY_SEGMENT_CAP` | no | texting cap per workspace per month, in segments (default 4000; `0` = none). Over it, email instead |
| `SMS_COST_PER_SEGMENT` | no | for HQ's cost estimate (default `0.0115`) |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | no | AI form parsing / AI fill |
| `API_BASE_URL` | no | server URL shown in the API docs |
| `EMAIL_RATE_LIMIT_GLOBAL_MS`, `EMAIL_RATE_LIMIT_PER_DOMAIN_MS`, `EMAIL_RETRY_BASE_DELAY_MS`, `EMAIL_RETRY_MAX_ATTEMPTS` | no | email pacing and retries |
| `HQ_JWT_SECRET` | yes for HQ | signs HQ sessions |
| `HQ_TIMEZONE` | no | HQ's weeks and days (default `America/New_York`) |
| `HQ_STRIPE_KEY` | no | a restricted read-only Stripe key for HQ Money (read on Balance, Balance transactions, Charges, Customers, Invoices, Payouts, Products, Subscriptions); otherwise `STRIPE_SECRET_KEY` |
| `KLAVIYO_PRIVATE_KEY`, `KLAVIYO_LIST_ID` | no | HQ email results and signals |
| `CONTENTFUL_SPACE_ID`, `CONTENTFUL_DELIVERY_TOKEN`, `CONTENTFUL_ENVIRONMENT`, `CONTENTFUL_CONTENT_TYPE` | no | HQ's blog list; blog posts count toward the blog campaign |
| `GOOGLE_SERVICE_ACCOUNT_JSON`, `GA4_PROPERTY_ID`, `GSC_SITE_URL` | no | HQ web and search results, and Google Sheets |
| `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID` | no | HQ YouTube results |
| `SAM_GOV_API_KEY` | no | HQ's federal listings feed (Public API Key, from Account Details on SAM.gov) |

No longer used: `STRIPE_PRICE_PRO_*`, `STRIPE_PRICE_FACILITY_*`, `STRIPE_FOUNDING_COUPON_ID`, `TWILIO_SID`, `TENANT_ROOT_DOMAIN`, `TENANT_APP_URL_SCHEME`, `TENANT_APP_URL_PORT`, `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`, `FRONTEND_BASE_URL`.

## Going live checklist
1. **Database:** existing workspaces need a one-time migration (people become accounts or staff contacts, old shifts and weeks are marked published, one owner per workspace):
   - Back up the database first.
   - `node scripts/migrate-legacy-data.js` shows what will change (dry run).
   - `node scripts/migrate-legacy-data.js --apply` makes the changes. It's safe to run again.
   - Each workspace gets one owner: the admin whose email is the workspace's email (who signed up), else the earliest admin.
   - Other accounts get one role: "admin" becomes scheduler, viewers stay viewers. Job roles on accounts are dropped.
   - Staff (job roles only) become staff contacts, keep all their roles and can no longer log in (they use their link). The same person added more than once (same email or phone) is merged into the first copy.
   - It checks everyone, not just people missing the new fields, and only changes what isn't already in the new shape.
2. **Env:** set `STAFF_LINK_KEY`, `FRONTEND_URL`, `API_PUBLIC_URL`, and rename `TWILIO_SID` → `TWILIO_ACCOUNT_SID`.
3. **Stripe:**
   - Nothing to create: checkout sends the plan's amount from `config/plans.js`. To change a price, edit `PLAN_PRICES` there (existing subscribers keep what they signed up at).
   - (Optional) To manage prices in the Stripe dashboard instead, create them and set the six `STRIPE_PRICE_*` IDs.
   - Enable the customer portal.
   - Webhook events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
4. **Twilio:**
   - Use a paid account. Trial accounts can only send Twilio's own sample messages.
   - **A number with approval:** either a toll-free number with **Toll-Free Verification**, or a local number with an **A2P 10DLC** brand and campaign. Unapproved numbers get blocked by carriers.
   - **Opt-in methods to describe:** a reply START or YES to our opt-in text, and a consent checkbox in the app for your own number.
   - **Sample messages:** `optInText`, `managerOptInText` and a call-out offer.
   - Put the number in a Messaging Service and set `TWILIO_MESSAGING_SERVICE_SID`.
   - Point incoming messages to `POST {API_PUBLIC_URL}/api/v1/sms/inbound`.
5. **Frontend:** serve the staff page at `/s/:token`.
