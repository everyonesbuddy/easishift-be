# WiserShifts backend pivot plan

**Repo:** `everyonesbuddy/easishift-be` · **Read at:** commit `267b1b8` (master, Oct 2 2026)
**Goal:** turn the current multi-tenant, login-for-everyone backend into the scheduler-first product. One scheduler signs up free, builds the week from a staffing template, and publishes it. Staff get a personal link by text or email; they never log in.

This is a **change list against the code that exists today**, written so you (or a backend LLM) can work through it in order. Every stage leaves the server running. Do not start a stage until the one before it passes its checks.

> **Status:** implemented in PRs #1–#9 (one per stage, stacked). The README describes the result. Where the code differs from this plan:
> - `claimCoverage` lives in `scheduleController.js` (it needs that file's open-shift helpers) instead of `utils/claimCoverage.js`.
> - The staff-only JWT routes (`/schedules/open-for-me`, `/schedules/pick-up`, `/schedules/:id/status`, `/preferences/me`, `/time-tracking/me|clock-in|clock-out|breaks`) were removed; staff use `/s/:token/...`.
> - `PUT /schedules/:id` and `PUT /coverage/:id` also got field whitelists (both accepted any body, including `tenantId`).

---

## 0. Read this first (ground rules for whoever implements this)

1. **Layer, don't rebuild.** Most of the product already exists:
   - `User` already models both schedulers (`roles: ['owner']`) and staff (`roles: ['cna']`).
   - `Coverage` already means "how many of a role a shift needs on a day", and `remaining` is already computed everywhere.
   - Every staff-side controller (pick-up, swaps, call-out, time off, preferences, clock-in) only reads `req.user` and `req.tenantId`. A staff link that sets those two fields makes all of them work **without being rewritten**.
2. **Move, don't copy.** When this plan says to move a helper into `utils/`, cut it from the controller and import it back. Don't keep two versions.
3. **The data is disposable.** There is one test tenant and no paying customer. Drop the database at the start (Stage 0). There are no data migrations in this plan.
4. **Keep names that already exist.** Field names like `requiredCount`, `shiftType`, `shiftTag`, `unitArea`, `roleFamilies` and `shiftTypeDefinitions` stay as they are, so the existing frontend keeps working while it's updated.
5. **Error shape for new code:** `res.status(code).json({ message, errorCode, ...details })`, which matches what the codebase already does.
6. Tests use `node:test`. Set `"test": "node --test tests/"` in `package.json`; the current script just exits with an error.

---

## 1. What exists today (short version)

| Area | Today | In the new direction |
|---|---|---|
| Tenant | One facility, plus subdomain, Netlify alias, branding, seat-based plans | Stays as "the workspace". Lose subdomain, seats and industry. Gain plan, trial and facility type. |
| User | Everyone logs in; `email` and `passwordHash` are required and globally unique | Two kinds: **accounts** (owner/scheduler/viewer, can log in) and **staff contacts** (no login, phone and/or email) |
| Roles | `config/authorization.js` handles system roles (owner, admin, scheduler, staff) and facility roles (from `roleFamilies`) | Keep it. Add `viewer`; make `admin` an alias of `scheduler`. |
| Coverage | Created by hand per date | Generated from a **staffing template** per week; editable per day |
| Schedule | Created live; the staff member is texted or emailed on every create | Assignments are **draft until the week is published**; one message per person on publish |
| AutoScheduleDraft + autoGenerate | AI/fairness auto-fill | Keep as the **Facility** plan's "Auto-fill" |
| ShiftSwap | pending_admin → pending_receiver → accepted | Keep as is; staff use it from their link |
| TimeOff, Preferences | Staff call with a JWT | Same controllers, called through the staff link |
| TimeEntry / time tracking | Staff clock in with a JWT | Same controllers through the link; Facility plan only |
| Message | In-app inbox | Facility plan: messages are also delivered by text/email |
| Stripe | 6 seat-based plans, prior-period charge, Stripe trials | Pro and Facility, monthly or yearly, founding coupon, opt-in no-card 14-day Pro trial |
| Notifications | `notifyUsersBestEffort` + email/SMS sends inline in controllers | One `utils/notify.js` that picks SMS or email by plan and consent and logs every send |
| Reminders | `utils/scheduleJobs.js` reads fields that don't exist on `Message`, so **no reminder has ever been sent** | Real hourly reminder job |

---

## 2. Decisions this plan locks in

- **Plans** (in `config/plans.js`, the single source of truth):

  | Plan | Schedulers (owner + schedulers; viewers are free) | Active staff | Features |
  |---|---|---|---|
  | free | 1 | 15 | email only |
  | pro | 3 | 75 | `sms`, `swaps`, `pickup`, `calloutText`, `import`, `reminders` |
  | facility | 10 | 200 | pro + `autoFill`, `timeClock`, `timesheets`, `messaging`, `dashboard` |
  | organization | unlimited | unlimited | facility + `branding` |

- **Everyone starts on Free.** Pro is a **14-day trial the owner starts themselves**, once per workspace, with no card. The app offers it when they hit a Pro feature or a Free limit (every 402 response carries `trialAvailable`).
- **Over the limit after a trial or a cancel:** nothing is deleted and nothing is archived automatically. The workspace is **over limit** until the owner pays or archives staff/demotes schedulers down to the plan's limits (they choose who). While over limit:
  - **Blocked:** publishing a week, adding staff, inviting schedulers.
  - **Still works:** viewing and editing the schedule, already-published weeks, staff links, time off.

  This stops anyone running 75 people on Free indefinitely without punishing the staff who already have their shifts.
- **Workspace roles:** `owner` (one per workspace; billing and settings), `scheduler` (everything except billing and workspace deletion), `viewer` (read-only schedule, free).
- **Staff contacts** have `loginEnabled: false`, need a name plus a phone or an email, and only ever have facility roles (`cna`, `rn`, …). They never hold a system role.
- **Staff link:** a random 256-bit token. It is stored as a SHA-256 hash for lookup, plus an AES-GCM encrypted copy so it can be re-sent. It does not expire and can be rotated. There is no verification code in v1 (we accepted the risk of a link being shared).
- **No subdomains.** One app URL (`FRONTEND_URL`). White-label branding stays in the code but is only enabled on `organization`.
- **Published-week edits** apply immediately and notify only the affected person, unless the request body sends `notify: false`.

---

## Stage 0: Reset, remove subdomains, fix existing bugs

### 0.1 Reset the database
```js
// mongosh, connected to the WiserShifts DB
db.getCollectionNames().forEach(c => db[c].drop());
```

### 0.2 Delete these files
- `utils/tenantDomainUtils.js`
- `utils/netlifyDomainUtils.js`
- `tests/netlifyDomainUtils.test.js`
- `tests/tenantWhiteLabel.test.js` (it imports `tenantDomainUtils`)
- `scripts/`: the whole folder. Every script is a backfill or migration for data that no longer exists, or creates checkout links for the old plans.
- `debug.log` (also add `*.log` to `.gitignore`)

### 0.3 Edit files that used subdomains
- **`app.js`**
  - Remove the `isTenantSubdomainOrigin` import and its use in `isAllowedOrigin`.
  - Replace the hardcoded `allowedOrigins` with `new Set((process.env.ALLOWED_ORIGINS || "https://wisershifts.com,http://localhost:5173").split(","))`.
- **`controllers/authController.js`**
  - Remove the `tenantDomainUtils` and `netlifyDomainUtils` imports.
  - Delete `isOutsideRequestTenant` and every call to it (in `loginStaff` and `forgotPassword`).
  - `buildResetUrl` becomes `` `${FRONTEND_URL}${FRONTEND_RESET_PATH}?token=${token}` `` with no tenant lookup.
  - Strip the subdomain, branding and Netlify parts of `registerTenant`. Stage 3 rewrites it anyway.
- **`controllers/tenantController.js`**: in `updateMyBranding`, delete the whole `req.body.subdomain` block, including the Netlify alias swap.
- **`controllers/publicTenantController.js`**: delete `checkSubdomainAvailability`, and the subdomain lookup in `getTenantBranding` (delete that function too). Keep `getTenantLogo`. Update `routes/publicRoutes.js` to match.
- **`controllers/stripeController.js`**: replace `buildTenantAppUrl(tenant.subdomain) || frontendUrl` with `frontendUrl`. Stage 1 rewrites this file.
- **`models/tenantModel.js`**: remove `subdomain` and its partial index. Stage 1 does the rest of the model changes.

### 0.4 Fix bugs found while reading (do these now; they're small)

| # | File / function | Problem | Fix |
|---|---|---|---|
| B1 | `routes/tenantRoutes.js` `GET /:id` → `getTenantById` | Any logged-in user can read **any** tenant by id, including Stripe ids | Replace it with `GET /me` (auth + tenant) that returns `req.tenant` without Stripe fields. Delete `GET /:id`. |
| B2 | `tenantRoutes` `GET /` and `POST /` use `restrictTo("superadmin")` | No `superadmin` role exists, so these routes are dead | Delete both routes, plus `getTenants` and `createTenant` |
| B3 | `scheduleController.createSchedule` (line ~3137) and `updateSchedule` (~3445) | `User.findById(staffId)` is not scoped to the tenant, so a scheduler can assign another tenant's user | `User.findOne({ _id: staffId, tenantId: req.tenantId, status: "active" })` |
| B4 | `timeOffController.reviewTimeOff` (~186) | Same unscoped `User.findById` | Scope it by `tenantId` |
| B5 | `messageController.getMessages`, `getMessagesByReceiver`, `getMessagesBySender` | Any staff member can read every message in the tenant, and anyone's inbox by id | If the caller lacks `messages.manage`, force the filter to `{ $or: [{senderId: me}, {receiverId: me}] }` and ignore the `:receiverId`/`:senderId` params |
| B6 | `utils/sendSMS.js` | It checks `TWILIO_ACCOUNT_SID` but builds the client with `TWILIO_SID`, so SMS only works when both are set | Use `TWILIO_ACCOUNT_SID` in both places. Stage 7 also adds `TWILIO_MESSAGING_SERVICE_SID`. |
| B7 | `utils/scheduleJobs.js` + the 8 AM cron in `app.js` | Reads `Message.status` and `msg.patientId`, which don't exist (copied from another project), so it never sends anything | Delete the function and the cron. Stage 7 replaces it. |
| B8 | `authController.sendTokenResponse` | Cookie is `secure: false` always | `secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 7d` |
| B9 | `scheduleController.getSchedules` | Staff can list everyone's schedules with populated email and phone | Staff use the link endpoints from Stage 6, so restrict this route with `requirePermission("schedule.view")` |
| B10 | `scheduleController.pickUpSchedule` | Race condition: two people can both pass the "remaining > 0" check and overfill the shift | Stage 7.4 (`claimCoverage`) fixes this |
| B11 | `coverageController.normalizeToUTC` | `new Date("2026-10-11T00:00:00-04:00")` lands on the wrong UTC day | Accept only `YYYY-MM-DD` strings and build `new Date(\`${d}T00:00:00.000Z\`)`. Stage 4 adds `utils/dateUtils.js` for this. |
| B12 | `authController.deleteUser` | Hard-deletes the person's schedules, time off and swaps, destroying history | Stage 2 replaces delete with archive |

**Check:** the server boots; `node --test tests/` passes (after the two deleted test files); signup and login work; no file still imports `tenantDomainUtils` (search with `grep -r tenantDomainUtils`).

---

## Stage 1: Plans, trial and billing

### 1.1 New `config/plans.js`
```js
const PLANS = {
  free:         { label: "Free",         schedulers: 1,        staff: 15,       features: [] },
  pro:          { label: "Pro",          schedulers: 3,        staff: 75,       features: ["sms","swaps","pickup","calloutText","import","reminders"] },
  facility:     { label: "Facility",     schedulers: 10,       staff: 200,      features: ["sms","swaps","pickup","calloutText","import","reminders","autoFill","timeClock","timesheets","messaging","dashboard"] },
  organization: { label: "Organization", schedulers: Infinity, staff: Infinity, features: ["sms","swaps","pickup","calloutText","import","reminders","autoFill","timeClock","timesheets","messaging","dashboard","branding"] },
};
const PAID_STATUSES = ["active", "trialing", "past_due"];
const TRIAL_DAYS = 14;

function getEffectivePlanKey(tenant, now = new Date()) {
  if (tenant.plan !== "free" && PAID_STATUSES.includes(tenant.subscriptionStatus)) return tenant.plan;
  if (tenant.trialEndsAt && tenant.trialEndsAt > now) return "pro";
  return "free";
}
const getPlan = (key) => ({ key, ...PLANS[key] });
const hasFeature = (planKey, feature) => PLANS[planKey].features.includes(feature);
// Cheapest plan that has the feature, used in 402 responses
const requiredPlanFor = (feature) => ["pro","facility","organization"].find(k => hasFeature(k, feature));

const trialAvailable = (tenant) => !tenant.trialUsedAt && !PAID_STATUSES.includes(tenant.subscriptionStatus);

module.exports = { PLANS, TRIAL_DAYS, getEffectivePlanKey, getPlan, hasFeature, requiredPlanFor, trialAvailable };
```

### 1.2 `models/tenantModel.js`
- **Remove:** `seatLimit`, `planKey`, `industry`; `unique: true` on `email` (keep the field as the contact email).
- **Keep `trialUsedAt`.** It now means "the Pro trial was started", and it guarantees one trial per workspace.
- **Add:**
  ```js
  facilityType: { type: String, enum: ["assisted_living","memory_care","skilled_nursing","home_care","other", null], default: null },
  plan: { type: String, enum: ["free","pro","facility","organization"], default: "free" }, // the PAID plan
  billingInterval: { type: String, enum: ["month","year", null], default: null },
  trialEndsAt: { type: Date, default: null },   // set only when the owner starts the trial
  foundingMember: { type: Boolean, default: false },
  setupCompletedAt: { type: Date, default: null },
  ```
- Keep `subscriptionStatus`, the `stripe*` fields, `branding`, `terms*`, `address` and `tenantPhone*`.

### 1.3 Attach the plan to every request
In `middleware/tenantMiddleware.js`, after loading the tenant:
```js
const { getEffectivePlanKey, getPlan } = require("../config/plans");
req.plan = getPlan(getEffectivePlanKey(tenant));
```
New `middleware/planMiddleware.js`:
```js
const { hasFeature, requiredPlanFor, trialAvailable } = require("../config/plans");
exports.requireFeature = (feature) => (req, res, next) => {
  if (hasFeature(req.plan.key, feature)) return next();
  const requiredPlan = requiredPlanFor(feature);
  return res.status(402).json({
    message: `This needs the ${requiredPlan} plan`,
    errorCode: "PLAN_FEATURE_REQUIRED", feature, currentPlan: req.plan.key, requiredPlan,
    trialAvailable: requiredPlan === "pro" && trialAvailable(req.tenant),   // UI shows "Try Pro free for 14 days"
  });
};
```
New `utils/planLimits.js`:
```js
const User = require("../models/userModel");
const SCHEDULER_ROLES = ["owner","admin","scheduler"];
exports.countActiveStaff = (tenantId) => User.countDocuments({ tenantId, loginEnabled: false, status: "active" });
exports.countSchedulers = (tenantId) => User.countDocuments({ tenantId, loginEnabled: true, roles: { $in: SCHEDULER_ROLES } });
exports.assertLimit = async (req, kind, adding = 1) => {   // kind: "staff" | "schedulers"
  const used = kind === "staff" ? await exports.countActiveStaff(req.tenantId) : await exports.countSchedulers(req.tenantId);
  const limit = req.plan[kind];
  if (used + adding > limit) {
    const err = new Error(`Your ${req.plan.label} plan allows ${limit} ${kind}`);
    err.statusCode = 402; err.errorCode = "PLAN_LIMIT_REACHED";
    err.details = { kind, used, limit, currentPlan: req.plan.key, trialAvailable: trialAvailable(req.tenant) };
    throw err;
  }
};
// Over limit = more active staff or schedulers than the effective plan allows (after a trial ends or a cancel).
exports.getUsage = async (req) => {
  const [staff, schedulers] = await Promise.all([exports.countActiveStaff(req.tenantId), exports.countSchedulers(req.tenantId)]);
  return { staff, schedulers, overLimit: staff > req.plan.staff || schedulers > req.plan.schedulers };
};
exports.assertNotOverLimit = async (req) => {
  const usage = await exports.getUsage(req);
  if (!usage.overLimit) return usage;
  const err = new Error(`You have more staff or schedulers than the ${req.plan.label} plan allows. Upgrade, or archive staff to get back under the limit.`);
  err.statusCode = 402; err.errorCode = "OVER_PLAN_LIMIT";
  err.details = { usage, limits: { staff: req.plan.staff, schedulers: req.plan.schedulers }, currentPlan: req.plan.key, trialAvailable: trialAvailable(req.tenant) };
  throw err;
};
```
(`utils/planLimits.js` also imports `trialAvailable` from `config/plans`.)

Update `middleware/errorMiddleware.js` to include `errorCode` and `...err.details` in the JSON when they're present.

### 1.3b Starting the Pro trial (opt-in)
New route `POST /api/v1/billing/start-trial` (auth, tenant, `billing.manage`, so only the owner). It goes in a small `routes/billingRoutes.js` → `stripeController.startTrial`.
```js
exports.startTrial = async (req, res) => {
  if (!trialAvailable(req.tenant)) return res.status(409).json({ message: "Your free trial has already been used", errorCode: "TRIAL_ALREADY_USED" });
  const now = new Date();
  req.tenant.trialUsedAt = now;
  req.tenant.trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 864e5);
  await req.tenant.save();
  res.json({ plan: "pro", trialEndsAt: req.tenant.trialEndsAt });
};
```
- **Trial reminder emails** (optional, but they convert): in the daily job, email the owner 3 days before `trialEndsAt` and on the day it ends.
  - The day-before email should say exactly what changes: "You have 42 staff; Free allows 15. Publishing will pause until you upgrade or archive staff."
  - Track `trialReminderSentAt` / `trialEndedEmailSentAt` on the tenant so each email is sent once.

### 1.4 Rewrite `controllers/stripeController.js`
- **Delete:** the six `*PriceCents` constants, `PLANS`, `TRIAL_DAYS_BY_INTERVAL`, `previousMonthLabel`, `getTrialPeriodDays`, `getSeatsInUse`, `buildPlanOption`, `buildCheckoutLineItems`, all `includePriorPeriodCharge` handling, and every seat check.
- Create the products and prices once in the Stripe dashboard and put the **Price IDs** in env:
  `STRIPE_PRICE_PRO_MONTHLY` ($49), `STRIPE_PRICE_PRO_YEARLY` ($490), `STRIPE_PRICE_FACILITY_MONTHLY` ($179), `STRIPE_PRICE_FACILITY_YEARLY` ($1,790).
- Founding price: a Stripe coupon "$20 off, forever, Pro monthly only" → `STRIPE_FOUNDING_COUPON_ID`.
- `const PRICE_BY_PLAN = { "pro:month": env.STRIPE_PRICE_PRO_MONTHLY, ... }` plus its reverse map `PLAN_BY_PRICE`.
- **`GET /stripe/plans`** returns the plans table from `config/plans.js` with prices, plus `{ currentPlan, effectivePlan, trialAvailable, trialEndsAt, foundingSpotsLeft, usage: { staff, schedulers, overLimit } }`. Compute `foundingSpotsLeft` as `20 - Tenant.countDocuments({ foundingMember: true })`.
- **`POST /stripe/create-checkout-session`** `{ plan: "pro"|"facility", interval: "month"|"year" }`:
  - Use `line_items: [{ price, quantity: 1 }]` and `client_reference_id: tenantId`, with `metadata: { tenantId, plan, interval }` on **both** the session and the subscription (`subscription_data.metadata`).
  - If `plan === "pro" && interval === "month" && foundingSpotsLeft > 0`, add `discounts: [{ coupon: STRIPE_FOUNDING_COUPON_ID }]` and `metadata.founding = "1"`.
  - Never pass `trial_period_days`. The trial lives in our database (1.3b), not in Stripe. If someone pays mid-trial, the subscription simply starts now.
  - `success_url: ${FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`, `cancel_url: ${FRONTEND_URL}/billing/cancel`.
  - Keep the existing 409 `SUBSCRIPTION_ALREADY_ACTIVE` guard.
- **`POST /stripe/change-plan`** `{ plan, interval }`: `stripe.subscriptions.update(subId, { items: [{ id: itemId, price }], proration_behavior: "create_prorations", metadata })`.
  - Before a downgrade, check the target plan's limits against current usage. If usage is over, return 409 `PLAN_BELOW_USAGE` with `{ kind, used, limit }`.
- **`POST /stripe/portal`** (new): `stripe.billingPortal.sessions.create({ customer, return_url: FRONTEND_URL + "/settings/billing" })`. This covers invoices, card changes and cancelling, so `cancel-subscription` can be deleted (or kept as a thin wrapper).
- **Webhook** (`handleWebhook`): keep the signature check.
  - `checkout.session.completed` sets `plan`, `billingInterval`, `stripeCustomerId`, `stripeSubscriptionId`, `stripePriceId` and `subscriptionStatus`, plus `foundingMember: true` if `metadata.founding`.
  - `customer.subscription.updated` sets `subscriptionStatus`, and `plan` and `billingInterval` from `PLAN_BY_PRICE[item.price.id]`.
  - `customer.subscription.deleted` sets `subscriptionStatus: "canceled"` and `plan: "free"`.
  - `invoice.payment_failed` sets `subscriptionStatus: "past_due"`.
- `tests/stripeController.test.js`: delete the line-item tests. Add tests for `PLAN_BY_PRICE` and `getEffectivePlanKey` (trial active, trial expired, paid, canceled).

**Check:**
- A new tenant reports `effectivePlan: "free"` and `trialAvailable: true`.
- `POST /billing/start-trial` makes it `"pro"` with `trialEndsAt` 14 days out. A second call returns 409 `TRIAL_ALREADY_USED`.
- Set `trialEndsAt` to the past and it reports `"free"`. With 40 active staff, `usage.overLimit` is `true`. A test-mode checkout flips the plan through the webhook. `requireFeature("sms")` returns 402 on Free.

---

## Stage 2: Staff become contacts; schedulers become members

### 2.1 `models/userModel.js`
```js
email:        { type: String, lowercase: true, trim: true, default: null },      // was required + unique
passwordHash: { type: String, select: false, default: null },                     // was required
loginEnabled: { type: Boolean, default: false },  // true = owner/scheduler/viewer account
status:       { type: String, enum: ["active","archived"], default: "active", index: true },
phoneE164:    { type: String, default: null },    // set in pre("validate") from userPhoneCountryCode + userPhone
smsConsent: {
  status:    { type: String, enum: ["none","pending","opted_in","opted_out"], default: "none" },
  updatedAt: { type: Date, default: null },
},
notes:        { type: String, default: "" },
```
- `pre("validate")` sets `this.phoneE164 = buildE164Number(this.userPhoneCountryCode, this.userPhone) || null`. `buildE164Number` is currently defined **twice**: `scheduleController.js` line ~810 and `timeOffController.js` line ~18. Move it to a new `utils/phone.js` and import it in all three places.
- It also invalidates with `"name and a phone or email are required"` when `!this.loginEnabled && !this.email && !this.phoneE164`, and with `"accounts need email"` when `this.loginEnabled && !this.email`.
- **Indexes** (replace the old `unique: true` on email):
  ```js
  userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { loginEnabled: true, email: { $type: "string" } } });
  userSchema.index({ tenantId: 1, email: 1 }, { unique: true, partialFilterExpression: { loginEnabled: false, email: { $type: "string" } } });
  userSchema.index({ tenantId: 1, phoneE164: 1 }, { unique: true, partialFilterExpression: { loginEnabled: false, phoneE164: { $type: "string" } } });
  userSchema.index({ phoneE164: 1 });            // inbound SMS lookup
  userSchema.index({ tenantId: 1, status: 1 });
  ```
  This lets the same nurse be a contact at two facilities, and the same email be a scheduler account and also a staff contact.

### 2.2 `config/authorization.js`
- `SYSTEM_ROLE_PERMISSIONS.scheduler` becomes today's `admin` list: schedule, coverage, staff view/manage, `staff.reset_password`, `timeoff.review`, `messages.manage`, `facility_preferences.manage`.
- Add `viewer: ["schedule.view","coverage.view","staff.view","facility_preferences.view"]`.
- `LEGACY_ROLE_ALIASES` gets `admin: "scheduler"`, then delete the `admin` key from `SYSTEM_ROLE_PERMISSIONS`.
- `getEffectivePermissions` currently adds the `staff` permissions to **everyone**. Change it to add them only when the user has no system role, so viewers can't request swaps.
- Three places hardcode the string `"admin"` and must change once admin becomes an alias:
  - `scheduleController.getTenantAdmins` (line ~917) and the admin lookup in `timeOffController.requestTimeOff` (line ~70) query `{ roles: "admin" }` / `{ role: "admin" }`. Change both to `{ loginEnabled: true, roles: { $in: ["owner", "scheduler"] } }` and share one helper (it becomes `notifySchedulers` in Stage 5).
  - `summaryController.getAdminSummary` (line ~110) rejects anyone whose `role !== "admin"`. Your current owner only passes because of an old `role: "admin"` value; **every owner created by today's signup (`role: "owner"`) is already rejected**. Replace that check with `hasPermission(req.user, "staff.view")`.

### 2.3 New `controllers/staffController.js` + `routes/staffRoutes.js` → `/api/v1/staff`
All routes use `auth, tenant`.

| Method + path | Permission | Does |
|---|---|---|
| `GET /` | `staff.view` | `?status=active` by default. Returns contacts (`loginEnabled:false`) with `hasPhone`, `hasEmail`, `smsConsent.status` and `linkSentAt`. Never returns tokens. |
| `POST /` | `staff.manage` | `{ name, phone, countryCode, email, roles[], allowedShiftTypes[], allowedAreas[], certificationTags[], notes }`. Validates that every role is in the facility's `roleFamilies` and **not** a system role (rejects `owner`, `admin`, `scheduler`, `viewer`, `staff`, `user`, `other`). Calls `assertLimit(req,"staff")`, creates the user with `loginEnabled:false`, then `createStaffLink` (Stage 6). **Sends nothing.** Returns 201 `{ staff }`. |
| `POST /bulk` | `staff.manage` | `{ rows: [{ name, phone, email, role }] }` (paste from onboarding), max 500. Calls `assertLimit(req,"staff", rows.length)`. Per-row result like today's `bulkRegisterStaff` (created / skipped_duplicate / failed_validation). Duplicate means same tenant + email, or same tenant + phone. |
| `POST /import` | `staff.manage` + `requireFeature("import")` | Same as bulk but takes CSV through the existing multer `csvUpload` and `getBulkRows` (move both from `authController`/`authRoutes` into this file) |
| `PATCH /:id` | `staff.manage` | Edit the same fields as POST. Changing the phone resets `smsConsent` to `none`. |
| `POST /:id/archive` | `staff.manage` | `status:"archived"`. Revokes the link. Deletes **future** schedules (`startTime > now`) and cancels pending swaps. Past history stays. |
| `POST /:id/restore` | `staff.manage` | Calls `assertLimit` first, then sets `status:"active"` and creates a new link |
| `POST /:id/send-link` | `staff.manage` | Sends their link now via `notify` (kind `link`) |
| `POST /:id/rotate-link` | `staff.manage` | Revokes the old link, creates a new one, sends it |
| `DELETE /:id` | `staff.manage` | Only if they have **no** schedules or time entries (409 `HAS_HISTORY` otherwise, telling the client to archive instead) |

### 2.4 New `controllers/memberController.js` + `routes/memberRoutes.js` → `/api/v1/members`
These are the logins (owner, schedulers, viewers).

| Method + path | Permission | Does |
|---|---|---|
| `GET /` | `staff.view` | Users with `loginEnabled:true` |
| `POST /invite` | `roles.manage` (owner) | `{ name, email, role: "scheduler"\|"viewer" }`. Calls `assertLimit(req,"schedulers")` unless the role is viewer. Creates the user with `loginEnabled:true` and no password, then sends an invite with the existing `createPasswordSetupLink` (move it to `utils/passwordLinks.js`). The AcceptInvite screen uses the existing `POST /auth/reset-password`. |
| `PATCH /:id` | `roles.manage` | Change the role between scheduler and viewer (limit check when going to scheduler) |
| `POST /:id/make-owner` | `roles.manage` | Transfer ownership: the target becomes `owner` and the caller becomes `scheduler` |
| `DELETE /:id` | `roles.manage` | Remove the member (the owner can't remove themself) |

### 2.5 Trim `authController.js` and `authRoutes.js`
- **Delete:** `registerStaff`, `bulkRegisterStaff`, `getAllUsers`, `getSwapDirectory`, `getUserById`, `updateUser`, `deleteUser` and `deleteUserScopedData`, plus their routes. They're replaced by `/staff` and `/members`.
- **`loginStaff`** → rename to `login`. Add `loginEnabled: true` to the `findOne`, return 401 when there's no `passwordHash` (invite not accepted yet), and drop the branding lookup.
- **`forgotPassword`**: only look up `loginEnabled: true` users.
- **New `GET /auth/me`** (auth + tenant) returns `{ user, tenant: { _id, name, facilityType, setupCompletedAt }, plan: { key, label, limits: { staff, schedulers }, features }, trialAvailable, trialEndsAt, usage: { staff, schedulers, overLimit } }`. Build `usage` with `getUsage`. The frontend calls this on boot and after billing changes.

**Check:** create a contact with only a phone. A second contact with the same phone in the same tenant returns 409, but succeeds in another tenant. Archiving hides them from `GET /staff` and their future shifts are gone. Inviting a 2nd scheduler on Free returns 402 `PLAN_LIMIT_REACHED` with `trialAvailable: true`; inviting a viewer works. After a trial ends with 40 staff, publish returns 402 `OVER_PLAN_LIMIT`. Archive down to 15 and publish works again.

---

## Stage 3: Signup and facility-type presets

### 3.1 New `config/facilityPresets.js`
Each preset is `{ roleFamilies, unitAreas, shiftTypes, shiftTypeDefinitions, templateRules }`. Use 8-hour shifts by default: day 07:00–15:00 (`day`/`day_1`), evening 15:00–23:00 (`evening`/`evening_1`), night 23:00–07:00 (`night`/`night_1`, `spansOvernight: true`).

| facilityType | roleFamilies | Default needs per shift (Mon–Fri / Sat–Sun) |
|---|---|---|
| assisted_living | `caregiver, med_tech, lpn` | Day: caregiver 3/2, med_tech 1/1 · Eve: caregiver 2/2, med_tech 1/1 · Night: caregiver 2/2 |
| memory_care | `caregiver, med_tech, lpn` | Day: caregiver 3/3, med_tech 1/1 · Eve: caregiver 3/2, med_tech 1/1 · Night: caregiver 2/2 |
| skilled_nursing | `cna, lpn, rn` | Day: cna 6/5, lpn 2/2, rn 1/1 · Eve: cna 5/4, lpn 2/2, rn 1/1 · Night: cna 3/3, lpn 1/1, rn 1/1 |
| home_care | `caregiver` | Day 08:00–16:00 `day_1`: caregiver 2/1 · Overnight 20:00–08:00 `night_1`: caregiver 1/1 |
| other | `[]` | No shifts preset beyond day/evening/night; empty template |

`unitAreas: []` for all of them (the current schema default is `["al","il","mc"]`; change it to `[]`). Template rules store `countsByWeekday` as 7 numbers with **Sunday = 0**, so Mon–Fri/Sat–Sun 3/2 becomes `[2,3,3,3,3,3,2]`.

### 3.2 Rewrite `authController.registerTenant` → route `POST /auth/signup`
Keep `/signup/tenant` as an alias until the frontend switches.
- **Body:** `{ name, email, password, facilityName, timezone, termsAccepted, termsVersion }`. All are required except `termsVersion`; the password must be at least 8 characters.
- **Order:**
  1. Return 409 `EMAIL_IN_USE` if a `loginEnabled` user already has this email.
  2. `Tenant.create({ name: facilityName, email, plan: "free", terms... })`. **No trial here**; the owner starts it later (1.3b).
  3. `User.create({ tenantId, name, email, passwordHash, loginEnabled: true, role: "owner", roles: ["owner"] })`.
  4. `FacilityPreferences.create({ tenantId, facilityTimezone: timezone (validated with Luxon), facilityTimezoneConfirmed: true, unitAreas: [] })`.
  5. Send the welcome email (keep the existing best-effort block).
  6. `sendTokenResponse` with `{ user, tenant, plan }`, the same shape as `/auth/me`.
- If step 3 fails, delete the tenant. There's no replica set, so there's no transaction.

### 3.3 New `controllers/setupController.js` → `/api/v1/setup` (auth, tenant, `facility_preferences.manage`)
- `POST /facility-type` `{ facilityType }`:
  - Sets `tenant.facilityType`.
  - Writes the preset's `roleFamilies`, `unitAreas`, `shiftTypes` and `shiftTypeDefinitions` into FacilityPreferences.
  - Writes `templateRules` into the StaffingTemplate (Stage 4).
  - It won't overwrite a template that already has rules unless `{ overwrite: true }` is sent.
  - Returns the prefs and the template, which pre-fill the next two onboarding screens.
- `POST /complete` sets `tenant.setupCompletedAt = now`.
- Onboarding screens 3–5 (shift times and roles, needs, add staff) use the existing `POST /facility-preferences`, `PUT /staffing-template` and `POST /staff/bulk`.

**Check:** signup → facility-type `skilled_nursing` → `GET /facility-preferences` shows cna/lpn/rn and 3 shifts, and `GET /staffing-template` shows 9 rules.

---

## Stage 4: Staffing template and weeks

### 4.1 New `models/staffingTemplateModel.js`
```js
const ruleSchema = new mongoose.Schema({
  shiftType: { type: String, required: true, lowercase: true, trim: true },
  shiftTag:  { type: String, required: true, lowercase: true, trim: true },
  role:      { type: String, required: true, lowercase: true, trim: true },
  unitArea:  { type: String, default: null },
  requiredCertificationTags: { type: [String], default: [] },
  countsByWeekday: { type: [Number], validate: v => v.length === 7 && v.every(n => Number.isInteger(n) && n >= 0 && n <= 50), required: true }, // 0 = Sunday
});
const schema = new mongoose.Schema({
  tenantId: { type: ObjectId, ref: "Tenant", required: true, unique: true },
  rules: { type: [ruleSchema], default: [] },
  updatedBy: { type: ObjectId, ref: "User", default: null },
}, { timestamps: true });
```

### 4.2 Changes to existing models
- **`coverageModel.js`** adds:
  ```js
  source: { type: String, enum: ["template","manual"], default: "manual" },
  templateRuleId: { type: ObjectId, default: null },
  overridden: { type: Boolean, default: false },
  ```
- **`facilityPreferencesModel.js`** adds `weekStartsOn: { type: Number, min: 0, max: 6, default: 0 }` and changes the `unitAreas` default to `[]`.
- New **`models/scheduleWeekModel.js`**:
  ```js
  { tenantId: ObjectId (req), weekStart: Date (req),       // local date of the first day, stored at 00:00Z (same convention as Coverage.date)
    status: { enum: ["draft","published"], default: "draft" },
    generatedAt: Date, publishedAt: Date, publishedBy: ObjectId,
    lastPublish: { sms: Number, email: Number, notReached: [{ staffId, name, reason }] } }
  index { tenantId: 1, weekStart: 1 } unique
  ```

### 4.3 New `utils/dateUtils.js`
Move `normalizeToUTC`, `parseClockTime`, `buildShiftSlotLookup` and `buildWindowFromShiftSlot` here from `coverageController.js`, and import them back. Then add:
```js
const isDateKey = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const dateKeyToCoverageDate = key => new Date(`${key}T00:00:00.000Z`);
const coverageDateToKey = d => d.toISOString().slice(0, 10);
// The local week start (YYYY-MM-DD) containing `instant`
function weekStartFor(instant, tz, weekStartsOn) {
  const local = DateTime.fromJSDate(new Date(instant), { zone: tz }).startOf("day");
  const diff = (local.weekday % 7 - weekStartsOn + 7) % 7;   // Luxon weekday: Mon=1..Sun=7 → Sun=0
  return local.minus({ days: diff }).toISODate();
}
const weekDays = startKey => Array.from({ length: 7 }, (_, i) => DateTime.fromISO(startKey, { zone: "UTC" }).plus({ days: i }).toISODate());
```

### 4.4 New `utils/weekService.js`
- `assertWeekStart(key, prefs)`: 400 `INVALID_WEEK_START` unless `isDateKey(key)` and that date's weekday equals `prefs.weekStartsOn`.
- `ensureWeek({ tenantId, weekStart })` (idempotent):
  1. `ScheduleWeek.findOneAndUpdate({ tenantId, weekStart: dateKeyToCoverageDate(weekStart) }, { $setOnInsert: { status: "draft" } }, { upsert: true, new: true })`.
  2. If `week.generatedAt` is set, return the week.
  3. Load the template and prefs, and build the slot lookup.
  4. For each of the 7 days and each rule: `count = rule.countsByWeekday[weekday]`. If it's > 0, build the window with `buildWindowFromShiftSlot` and push a `bulkWrite` `updateOne` with `upsert: true`, filtered on the Coverage unique key (`tenantId, date, role, unitArea, shiftType, shiftTag, startTime, endTime`), `$setOnInsert: { source: "template", templateRuleId: rule._id, requiredCount: count, requiredCertificationTags }`.
  5. Set `generatedAt = now`.
  - It never touches rows that already exist, so running it twice is safe.
- `syncTemplateToWeeks({ tenantId, applyTo })`, where `applyTo` is `"unpublished"` (default) or `"all_future"`:
  - For weeks with `weekStart >= current week` (and `status: "draft"` unless `all_future`), for each template row with `source: "template", overridden: false`:
    - Set `requiredCount` to the new count.
    - Insert rows for new rules or days.
    - For removed rules: delete the row if nothing is assigned to it, otherwise set `requiredCount: 0`.
  - Rows the scheduler changed by hand (`overridden: true`) are left alone.

### 4.5 New routes
- `controllers/staffingTemplateController.js` → `/api/v1/staffing-template`:
  - `GET /` (`coverage.view`)
  - `PUT /` (`coverage.manage`) `{ rules, applyTo }`: validates every rule's `shiftType:shiftTag` exists in the slot lookup and its role is in `roleFamilies`, saves, calls `syncTemplateToWeeks`, and returns `{ template, weeksUpdated }`.
- `controllers/weekController.js` → `/api/v1/weeks`:
  - **`GET /:weekStart`** (`schedule.view`): calls `ensureWeek`, then returns everything the roster screen needs in **one** call:
    ```js
    { week: { weekStart, status, publishedAt },
      days: ["2026-10-11", ...],
      coverage: [{ ...coverage, assignedCount, remaining }],      // countAssignmentsByCoverage, same as coverageController.getCoverage
      schedules: [ ... ],                                          // tenant, startTime within the week, status != call_out included (show call-outs), populate staffId "name roles"
      staff: [{ _id, name, roles, allowedShiftTypes, allowedAreas, hasPhone, hasEmail, smsStatus }],   // active contacts only
      timeOff: [ ... ],                                            // pending + approved overlapping the week
      counts: { openSlots, unpublishedChanges } }
    ```
  - **`GET /:weekStart/candidates?coverageId=`** (`schedule.manage`): eligible staff for a slot, for the assign dialog. Each one is `{ staffId, name, eligible, reasons: ["role","conflict","time_off","area","shift_type","certification"], weekHours, overtimeIfAssigned }`, sorted with eligible people first, then lowest hours. Build it from the eligibility helpers in 4.6.
  - **`POST /:weekStart/publish`**: Stage 5.
- `coverageController.updateCoverage`: when `requiredCount` changes on a row with `source: "template"`, set `overridden: true`. Coverage create, update and delete stay for one-off rows and for changing a single day's needs.

### 4.6 New `utils/eligibility.js`
Move these out of `scheduleController.js`, unchanged, and import them back:
`normalizeRoleFamily`, `getStaffFacilityRoles`, `isStaffRoleCompatible`, `isStaffCompatibleWithCoverage` and everything it calls (`getStaffAllowedAreas`, `getStaffAllowedShiftTypes`, `isAreaCompatible`, `isShiftTypeCompatible`, `isCertificationCompatible`, `getCoverage*`, `getStaffExplicit*`, `normalizeAreaTag/ShiftType/ShiftTag`, `dedupeStrings`), and `getCompatibleFacilityConfig`. Add:
```js
async function eligibleStaffForCoverage({ tenantId, coverage, facilityConfig, excludeStaffIds = [] }) // role/area/shift/cert + no conflict (hasConflict) + no approved time off; returns [{ staff, weekMinutes }]
```

**Check:**
- `GET /weeks/2026-10-11` on a skilled_nursing tenant (weekStartsOn 0) creates 63 coverage rows (9 rules × 7 days) the first time and 0 the second time.
- Changing Tuesday Day CNA to 7 with `PUT /coverage/:id` sets `overridden`.
- A template save changing Day CNA weekdays to 6 updates every weekday row in draft weeks **except** that Tuesday.

---

## Stage 5: Draft vs published, and one message per person

### 5.1 `models/scheduleModel.js`
```js
state: { type: String, enum: ["draft","published"], default: "published", index: true },
// in meta:
reminderSentAt: Date, calledOutAt: Date, callOutReason: String, source: String,
```
Also add `meta.source` to the schema; `pickUpSchedule` already writes it, but it's being dropped. Add the index `{ tenantId: 1, state: 1, startTime: 1 }`.

### 5.2 Every place that creates a Schedule must pick a state
Add `utils/weekService.js#stateForNewSchedule({ tenantId, startTime })`:
1. Compute `weekStartFor(startTime, tz, weekStartsOn)`.
2. `ensureWeek`.
3. Return `week.status === "published" ? "published" : "draft"`.

Use it in:
- `scheduleController.createSchedule`. Only run the existing "notify assigned staff" block when the state is `published` **and** `req.body.notify !== false`, and replace that block with `notify.sendToStaff` (5.4).
- `scheduleController.updateSchedule`. If the schedule is published and the staff, time or role changed, notify the old and new person, unless `notify === false`.
- `scheduleController.deleteSchedule` / `deleteSchedulesByIds`: if the schedule was published and in the future, tell that person "your shift on … was removed" unless `notify === false`.
- `scheduleController.publishAutoScheduleDraft` (`insertMany` at ~2638): set `state` on every payload row.
- `pickUpSchedule`, and the swap acceptance in `respondToShiftSwapRequest`: always `published`. These only happen in published weeks.

**Drafts still count as assigned** (`countAssignmentsByCoverage` doesn't filter by `state`, so leave it). That way the scheduler's own view and open-shift math agree.

### 5.3 Open shifts only come from published weeks
In `getOpenCoverageForStaff`:
- Load `ScheduleWeek.find({ tenantId, status: "published", weekStart: { $gte: currentWeekStart - 7d } })`.
- Keep coverages whose `date` falls inside one of those weeks.

### 5.4 New `utils/notify.js`
This replaces the scattered sends.
```js
// Decides channel, sends, logs. Never throws.
async function sendToStaff({ tenant, plan, staff, kind, sms, emailSubject, emailHtml }) {
  // kind: "week_published" | "shift_changed" | "shift_removed" | "callout_offer" | "reminder" | "link" | "swap" | "timeoff" | "message"
  const canSms = hasFeature(plan.key, "sms") && staff.phoneE164;
  if (canSms && staff.smsConsent.status === "opted_in") → sendSMS(staff.phoneE164, sms) → log channel "sms"
  else if (staff.email) → sendEmail(staff.email, emailSubject, emailHtml, null, { tenantId }) → log channel "email"
  else if (canSms && staff.smsConsent.status === "none") → send OPT_IN_TEXT, set consent "pending" → log, return { delivered: false, reason: "awaiting_opt_in" }
  else return { delivered: false, reason: !staff.phoneE164 && !staff.email ? "no_contact" : staff.smsConsent.status === "opted_out" ? "opted_out" : canSms ? "awaiting_opt_in" : "sms_needs_pro" };
}
```
- `OPT_IN_TEXT`: `"{Facility} uses WiserShifts to send your work schedule. Reply START to get schedule texts. Msg & data rates may apply. Reply STOP to opt out, HELP for help."` The exact wording must match the Twilio A2P campaign you register.
- New `models/outboundMessageModel.js`: `{ tenantId, staffId, kind, channel: "sms"|"email", to, status: "sent"|"failed", error, providerId, refId (schedule/coverage/offer id), createdAt }`, with indexes `{ tenantId, createdAt: -1 }` and `{ to: 1, createdAt: -1 }`. Log every send.
- `getStaffLinkUrl(staff)` (Stage 6) supplies the link that goes in every message.
- Switch `scheduleController.notifyUsersBestEffort`, the inline sends in `createSchedule`, and the sends in `timeOffController` to `sendToStaff`. Keep `notifyUsersBestEffort` for **schedulers** (account users, always email) and rename it `notifySchedulers`.

### 5.5 `POST /api/v1/weeks/:weekStart/publish` (`schedule.manage`)
0. `await assertNotOverLimit(req)`: 402 `OVER_PLAN_LIMIT` when the workspace has more staff or schedulers than its plan allows. This is the **only** place over-limit blocks the schedule itself. Already-published weeks, edits, staff links and time off keep working.
1. `ensureWeek`.
2. `Schedule.updateMany({ tenantId, state: "draft", startTime: { $gte: weekStartInstant, $lt: weekEndInstant } }, { $set: { state: "published", "meta.publishedAt": now } })`. Compute the instants in the facility time zone.
3. Collect the recipients: active contacts with ≥1 published, non-call-out shift that week. With `{ includeEveryone: true }`, it's all active contacts.
4. For each recipient, `sendToStaff` with kind `week_published`:
   - **SMS:** `"Hi {first}, your {Facility} schedule for {Oct 11–17} is ready: {link}"`
   - **Email:** a list of their shifts in facility time, plus the link.
5. Save `week.status = "published"`, `publishedAt`, `publishedBy`, `lastPublish = { sms, email, notReached }`.
6. Respond `200 { week, sent: { sms, email }, notReached: [{ staffId, name, reason }] }`. This feeds the PublishDone screen.
- Publishing an already-published week re-sends only to people with changed shifts since `publishedAt` (`Schedule.updatedAt > publishedAt`). `{ resendAll: true }` sends to everyone.

**Check:**
- Assigning in a draft week sends nothing and the staff link shows nothing for that week.
- Publish returns counts, and the link now shows the shifts.
- Editing a published shift texts only that person; with `notify:false` it texts no one.
- A Free-plan tenant gets email only; a phone-only contact on Free shows in `notReached` with `sms_needs_pro`.

---

## Stage 6: The staff link (staff never log in)

### 6.1 New `models/staffLinkModel.js`
```js
{ tenantId: ObjectId (req), staffId: ObjectId (req),
  tokenHash: { type: String, required: true, unique: true },   // sha256(token) hex
  tokenEnc: { type: String, required: true },                   // AES-256-GCM(token) with STAFF_LINK_KEY, "iv:tag:cipher" base64
  revokedAt: { type: Date, default: null }, lastUsedAt: Date, sentAt: Date }
index { staffId: 1 } unique, partialFilterExpression { revokedAt: null }   // one live link per person
```

### 6.2 New `utils/staffLinks.js`
- `createStaffLink(staff)`: `token = crypto.randomBytes(32).toString("base64url")`. Save the hash and the encrypted copy, and return the token.
- `getStaffLinkUrl(staffId)`: find the live link, decrypt it, and return `${FRONTEND_URL}/s/${token}`. If there's no live link, create one.
- `rotateStaffLink(staffId)`: set `revokedAt` on the old link and create a new one.
- `STAFF_LINK_KEY` is required at boot: 32 bytes as hex. The server should refuse to start without it, with **no fallback to JWT_SECRET**.

### 6.3 New `middleware/staffLinkMiddleware.js`
```js
module.exports = async (req, res, next) => {
  const token = req.params.token;
  if (!token || token.length < 40) return res.status(404).json({ message: "Link not found", errorCode: "LINK_INVALID" });
  const link = await StaffLink.findOne({ tokenHash: sha256(token), revokedAt: null });
  if (!link) return res.status(404).json({ message: "Link not found", errorCode: "LINK_INVALID" });
  const [user, tenant] = await Promise.all([
    User.findOne({ _id: link.staffId, tenantId: link.tenantId, status: "active", loginEnabled: false }),
    Tenant.findById(link.tenantId),
  ]);
  if (!user || !tenant) return res.status(404).json({ message: "Link not found", errorCode: "LINK_INVALID" });
  req.user = user;                         // controllers use req.user._id — unchanged
  req.user.roles = getUserRoles(user);     // facility roles only (enforced in Stage 2.3)
  req.user.permissions = SYSTEM_ROLE_PERMISSIONS.staff;
  req.tenantId = String(link.tenantId);
  req.tenant = tenant;
  req.plan = getPlan(getEffectivePlanKey(tenant));
  req.authKind = "staff_link";
  if (!link.lastUsedAt || Date.now() - link.lastUsedAt > 3600e3) StaffLink.updateOne({ _id: link._id }, { lastUsedAt: new Date() }).catch(() => {});
  next();
};
```
This is safe with `hasPermission` because it recomputes from `roles`, and contacts can't hold system roles (2.3). Add a defensive check anyway: if `getSystemRoles(user).length`, return 404.

### 6.4 New `routes/staffLinkRoutes.js`
Mount it as `app.use("/api/v1/s/:token", staffLinkRouter)` with `express.Router({ mergeParams: true })`, `router.use(staffLink)`, and a rate limit (add `express-rate-limit`, 120 requests/min per IP).

| Route | Handler | Gate |
|---|---|---|
| `GET /me` | **new** `staffPortalController.getMe`: `{ staff: { name, roles }, facility: { name, timezone }, features: { swaps, pickup, clockIn }, smsConsent }` | none |
| `GET /schedule?from&to` | **new** `getMySchedule`: `Schedule.find({ tenantId, staffId: req.user._id, state: "published", ... })`. Don't reuse `getSchedules`, which lists everyone. | none |
| `GET /open-shifts` | `scheduleController.getOpenCoverageForMe` | `pickup` |
| `POST /open-shifts/pick-up` | `pickUpSchedule` (after the Stage 7.4 change) | `pickup` |
| `GET /swap-candidates/:scheduleId` | **new**: the schedule must be mine. `eligibleStaffForCoverage` for the same role/time, names only. | `swaps` |
| `POST /schedules/:id/swap` | `requestShiftSwap` (route param `id` already matches) | `swaps` |
| `GET /swaps` | `getShiftSwapRequests` (already restricts non-managers to their own) | `swaps` |
| `POST /swaps/:swapRequestId/respond` | `respondToShiftSwapRequest` | `swaps` |
| `POST /schedules/:id/call-out` | small wrapper: sets `req.body.status = "call_out"`, then `updateOwnScheduleStatus`. **Add to that function:** set `meta.calledOutAt` and `callOutReason`, then email/text schedulers via `notifySchedulers` with a link to the Callout screen. | none |
| `GET /time-off`, `POST /time-off` | `getTimeOff`, `requestTimeOff`. **Change `requestTimeOff`** to also accept `{ startDate, endDate }` (`YYYY-MM-DD`, all-day). Convert them to instants with the facility time zone (start of `startDate` to end of `endDate`). | none |
| `GET /preferences`, `POST /preferences` | `getMyPreferences`, `upsertMyPreferences` | none |
| `GET /messages` | **new**: messages where `receiverId` is me | `messaging` |
| `POST /clock-in`, `/breaks/start`, `/breaks/end`, `/clock-out`, `GET /time-entries` | the existing `timeTrackingController` functions | `timeClock` |

`timeTrackingController` takes `source` from `req.body.source` (lines ~379 and ~448). When `req.authKind === "staff_link"`, ignore the body and always use `"web"`.

### 6.5 Remove staff use of the JWT routes
Swap, time-off, preference and pick-up routes under `/schedules`, `/timeoff` and `/preferences` stay for schedulers (`schedule.manage`). Staff no longer have logins, so nothing else changes there.

**Check:**
- An unknown token returns 404 `LINK_INVALID`, and so does a rotated old token.
- With a valid link: you see only your own published shifts; you can pick up an open shift (Pro); you get 402 on Free; you can request time off with dates only; call-out frees the slot and emails the scheduler.
- A contact can't reach any JWT route with a link token.

---

## Stage 7: Texting (opt-in, replies, call-outs, reminders)

### 7.1 Twilio setup (do this outside the code first)
- Register an A2P 10DLC brand and campaign (use case: "Account notifications / workforce scheduling"). Paste the exact opt-in text from 5.4 into the campaign.
- Create a Messaging Service and put its SID in `TWILIO_MESSAGING_SERVICE_SID`. `sendSMS` sends with `messagingServiceSid` when it's set, otherwise `from: TWILIO_PHONE_NUMBER`.
- Point the number's inbound webhook to `POST {API_PUBLIC_URL}/api/v1/sms/inbound`.

### 7.2 New `routes/smsRoutes.js` + `controllers/smsController.js`
- The route uses `express.urlencoded({ extended: false })`, then verifies `X-Twilio-Signature` with `twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, API_PUBLIC_URL + req.originalUrl, req.body)`; 403 if invalid.
- Read `From` (E.164) and `Body`. Normalize the keyword as `Body.trim().toUpperCase()`.
- Find `contacts = User.find({ phoneE164: From, loginEnabled: false, status: "active" })`. There can be several tenants.

| Keyword | Action | Reply (TwiML) |
|---|---|---|
| `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT` | Set `smsConsent` to `opted_out` on every matching contact | none (Twilio sends its own) |
| `START`, `UNSTOP` | `opted_in` on contacts that are `pending` or `opted_out`; then send each one their link (kind `link`) | "You're subscribed to schedule texts from {Facility}. Your schedule: {link}" |
| `YES`, `Y` | If there's an **open CalloutOffer** (7.3) sent to this phone in the last 12 h, run `claimCoverage` (7.4). Otherwise treat it like START. | claimed: "You're confirmed for {shift}. Thank you!"; taken: "Sorry, that shift was already filled." |
| `HELP` | none | "WiserShifts schedule texts for {Facility}. Reply STOP to opt out. Questions? Contact your scheduler." |
| anything else | Log only | none |

### 7.3 Call-out by text
- New `models/calloutOfferModel.js`:
  ```js
  { tenantId, coverageId, createdBy, status: { enum: ["open","filled","cancelled","expired"], default: "open" },
    recipients: [{ staffId, phoneE164, channel, sentAt, response: { enum: ["none","yes","too_late"], default: "none" } }],
    filledBy: ObjectId, filledAt: Date, expiresAt: Date }   // expiresAt = coverage.startTime
  index { "recipients.phoneE164": 1, status: 1, createdAt: -1 }
  ```
- **`POST /api/v1/schedules/:id/call-out`** (`schedule.manage`): the scheduler marks someone out (phone call at 5 AM). Same body as the staff version plus `reason`. Sets `status: "call_out"`, `meta.calledOutAt`, `meta.callOutReason`. Returns `{ schedule, coverage: { ...coverage, remaining }, candidates }` from `eligibleStaffForCoverage`.
- **`POST /api/v1/coverage/:id/fill-by-text`** (`schedule.manage` + `calloutText`), body `{ staffIds? }`:
  - Without `staffIds`, use every eligible person, skipping anyone whose projected week minutes would exceed `weeklyOvertimeThresholdHours`. Add `excludeOvertimeOnCallout: { type: Boolean, default: true }` to FacilityPreferences.
  - Create the offer.
  - `sendToStaff` kind `callout_offer`. SMS: `"{Facility} needs a {ROLE} {Fri Oct 16, 3p–11p}. Reply YES to take it, or tap: {link}/open"`.
  - Return `{ offerId, sentTo, notReached }`.
- **When an offer fills** (via a YES reply **or** a link pick-up of that coverage while an offer is open):
  - Mark it `filled`.
  - Text the other recipients who were sent SMS: `"The {shift} shift has been filled. Thanks!"`.
  - Email the schedulers through `notifySchedulers`.
- `GET /api/v1/coverage/:id/callout` returns the latest offer with each recipient's status, for the Callout screen.

### 7.4 Make claiming a slot safe: `utils/claimCoverage.js`
Pull the body of `pickUpSchedule` (from the coverage load through `Schedule.create`) into:
```js
async function claimCoverage({ tenantId, coverageId, staff, source }) {
  // ...existing checks: future start, eligible (getOpenCoverageForStaff), no approved time off, no conflict...
  const schedule = await Schedule.create({ ..., state: "published", meta: { createdBy: staff._id, source } });
  // Overfill guard without transactions: re-count, keep the earliest N by _id
  const occupying = await Schedule.find({ tenantId, coverageId, status: { $in: COVERAGE_OCCUPYING_STATUSES } }).sort({ _id: 1 }).select("_id").lean();
  if (occupying.findIndex(s => String(s._id) === String(schedule._id)) >= coverage.requiredCount) {
    await Schedule.deleteOne({ _id: schedule._id });
    return { ok: false, code: "SHIFT_ALREADY_FILLED" };
  }
  await autoRemoveDraftAssignmentForSchedule({ tenantId, schedule });
  await markOfferFilledIfAny({ tenantId, coverageId, staffId: staff._id });   // 7.3
  return { ok: true, schedule };
}
```
`pickUpSchedule` becomes a thin wrapper that maps `SHIFT_ALREADY_FILLED` to 409.

### 7.5 Real shift reminders
Replace `utils/scheduleJobs.js` with `sendShiftReminders()`, run by cron `"5 * * * *"` in `app.js`:
1. Load `FacilityPreferences` (`tenantId`, `shiftReminderLeadHours`) for tenants whose effective plan has `reminders`.
2. Per tenant: `Schedule.find({ tenantId, state: "published", status: "scheduled", startTime: { $gt: now + lead - 1h, $lte: now + lead }, "meta.reminderSentAt": null })`.
3. `sendToStaff` kind `reminder`: `"Reminder: you work {Fri 3p–11p} at {Facility}. Can't make it? {link}"`.
4. Set `meta.reminderSentAt`.

**Check:**
- Twilio test credentials: a phone-only contact gets the opt-in text on first publish. Replying START gets them the link. A second publish texts the link directly.
- With two staff replying YES at the same moment, exactly one gets the shift.
- STOP stops all texts and the contact appears in `notReached` as `opted_out`.

---

## Stage 8: Facility-plan features (mostly gating what exists)

| Feature | Existing code | Change |
|---|---|---|
| Auto-fill (`autoFill`) | `autoGenerateSchedule`, the draft routes, `fillAutoScheduleDraftAssignmentWithAI` | Add `requireFeature("autoFill")` to all the `/schedules/auto-generate` and `/schedules/draft-schedules*` routes. The frontend sends the week's coverage ids where `remaining > 0`. In `autoGenerateSchedule`, change `User.find({ tenantId })` (~line 1460) to `{ tenantId, loginEnabled: false, status: "active" }` so schedulers are never auto-assigned. |
| Time clock (`timeClock`) | `timeTrackingRoutes`, the cron in `app.js` | `requireFeature("timeClock")` on the scheduler routes too. In `facilityPreferencesController.upsertFacilityPreferences`, reject `timeTracking.enabled: true` with 402 unless the plan has `timeClock`. |
| Timesheets & payroll (`timesheets`) | `exportRoutes`, `listTimeEntries`, `adjustTimeEntry` | Add `requireFeature("timesheets")` |
| Messages (`messaging`) | `messageController` | `requireFeature("messaging")`. In `createMessage`, after creating the `Message` docs, deliver each one with `sendToStaff` kind `message` (SMS: `"{Facility}: {subject}. Read: {link}/messages"`). |
| Dashboard (`dashboard`) | `summaryController.getAdminSummary` | `requireFeature("dashboard")`. `getStaffSummary` is unused by staff now; delete it or gate it with `staff.view`. |
| Branding (`branding`) | `tenantController` branding and logo routes, `utils/tenantBranding.js` | `requireFeature("branding")` on `PATCH /tenants/me/branding` and `PUT /tenants/me/logo`. Emails keep using `getEmailBranding`, which falls back to the facility name. |
| AI form parse | `nlRoutes` | Leave it as is (not part of this pivot). |
| Organization multi-facility | none | **Don't build yet.** Sell it by hand. When the first one signs, add an `Organization { name, tenantIds[], ownerUserId }` and a membership array on account users. |

---

## Stage 9: Clean up

- `app.js`: register the new routers (`/staff`, `/members`, `/setup`, `/staffing-template`, `/weeks`, `/s/:token`, `/sms`); remove the deleted ones; remove the Expo origin patterns once you retire the mobile app.
- `docs/openapiSpec.js`: remove the deleted endpoints and add the new ones (at least paths and request bodies).
- `README.md`: replace the "multi-tenant" intro with the new model; update the env table.
- `package.json`: remove dependencies nothing requires: `crypto` (built into Node), `bcrypt` (the code uses `bcryptjs`), `esm`, `pkg.json`, `express-jwt`, `mongoose-unique-validator`, `validator`, `openapi-types` and `swagger-jsdoc`. A grep of every `require` at `267b1b8` found no use of any of them. Add `express-rate-limit`.

---

## 10. File-by-file index

**New**
`config/plans.js`, `config/facilityPresets.js`, `middleware/planMiddleware.js`, `middleware/staffLinkMiddleware.js`, `models/staffingTemplateModel.js`, `models/scheduleWeekModel.js`, `models/staffLinkModel.js`, `models/outboundMessageModel.js`, `models/calloutOfferModel.js`, `controllers/staffController.js`, `controllers/memberController.js`, `controllers/setupController.js`, `controllers/staffingTemplateController.js`, `controllers/weekController.js`, `controllers/staffPortalController.js`, `controllers/smsController.js`, `routes/staffRoutes.js`, `routes/memberRoutes.js`, `routes/setupRoutes.js`, `routes/staffingTemplateRoutes.js`, `routes/weekRoutes.js`, `routes/staffLinkRoutes.js`, `routes/smsRoutes.js`, `utils/planLimits.js`, `utils/dateUtils.js`, `utils/weekService.js`, `utils/eligibility.js`, `utils/notify.js`, `utils/staffLinks.js`, `utils/claimCoverage.js`, `utils/passwordLinks.js`, `utils/phone.js`, `routes/billingRoutes.js`

**Changed**

| File | Change |
|---|---|
| `app.js` | CORS from env, new routers, remove 8 AM cron, add reminder cron |
| `models/tenantModel.js` | − subdomain, seatLimit, planKey, industry, email unique; + facilityType, plan, billingInterval, trialEndsAt, foundingMember, setupCompletedAt; `trialUsedAt` kept (one opt-in trial) |
| `models/userModel.js` | email/password optional; + loginEnabled, status, phoneE164, smsConsent, notes; new indexes |
| `models/coverageModel.js` | + source, templateRuleId, overridden |
| `models/scheduleModel.js` | + state; meta.source, reminderSentAt, calledOutAt, callOutReason |
| `models/facilityPreferencesModel.js` | + weekStartsOn, excludeOvertimeOnCallout; unitAreas default `[]` |
| `config/authorization.js` | + viewer; admin → alias of scheduler; staff perms only for users without a system role |
| `middleware/tenantMiddleware.js` | sets `req.plan` |
| `middleware/errorMiddleware.js` | passes `errorCode` + `details` |
| `controllers/authController.js` | signup rewritten; login requires loginEnabled; + `/auth/me`; staff/user CRUD removed |
| `controllers/coverageController.js` | helpers moved to `utils/dateUtils.js`; `overridden` on template rows; date-key validation |
| `controllers/scheduleController.js` | helpers moved to `utils/eligibility.js`; state on create; notify via `utils/notify.js`; pickup via `claimCoverage`; call-out fields; scheduler call-out route; `getSchedules` restricted; autoGenerate candidate filter; tenant-scoped staff lookups |
| `controllers/timeOffController.js` | date-only requests; notify via `utils/notify.js`; tenant-scoped lookup |
| `controllers/messageController.js` | own-messages scoping; delivery by SMS/email |
| `controllers/stripeController.js` | rewritten for Pro/Facility, Price IDs, founding coupon, portal |
| `controllers/tenantController.js` | − subdomain block, − getTenants/createTenant/getTenantById; + `GET /me` |
| `controllers/publicTenantController.js` | only `getTenantLogo` remains |
| `controllers/timeTrackingController.js` | `source: "web"` for link users |
| `controllers/facilityPreferencesController.js` | timeTracking gate |
| `utils/sendSMS.js` | env fix; messagingServiceSid |
| `utils/scheduleJobs.js` | replaced by `sendShiftReminders` |
| `routes/*` | permissions and feature gates as listed above |

**Deleted**
`utils/tenantDomainUtils.js`, `utils/netlifyDomainUtils.js`, `tests/netlifyDomainUtils.test.js`, `tests/tenantWhiteLabel.test.js`, `scripts/` (all), `debug.log`

---

## 11. Environment variables

| Add | Purpose |
|---|---|
| `STAFF_LINK_KEY` | 32-byte hex key for encrypting staff link tokens (required; no fallback) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |
| `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_FACILITY_MONTHLY`, `STRIPE_PRICE_FACILITY_YEARLY` | Stripe Price IDs |
| `STRIPE_FOUNDING_COUPON_ID` | $20-off-forever coupon for the first 20 Pro monthly customers |
| `TWILIO_ACCOUNT_SID` | Replaces `TWILIO_SID` |
| `TWILIO_MESSAGING_SERVICE_SID` | A2P messaging service |

| Keep | `DB_URL`, `PORT`, `JWT_SECRET`, `FRONTEND_URL`, `FRONTEND_RESET_PATH`, `API_PUBLIC_URL`, `POSTMARK_*`, `EMAIL_*`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `ANTHROPIC_*`, `PASSWORD_SETUP_TTL_MINUTES`, `PASSWORD_RESET_TTL_MINUTES` |
|---|---|

| Remove | `TENANT_ROOT_DOMAIN`, `TENANT_APP_URL_SCHEME`, `TENANT_APP_URL_PORT`, `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`, `TWILIO_SID`, `FRONTEND_BASE_URL` (use `FRONTEND_URL`) |
|---|---|

---

## 12. Order of work and rough size

| Stage | What | Size |
|---|---|---|
| 0 | Reset, remove subdomains, bug fixes | ½ day |
| 1 | Plans, trial, Stripe | 1 day |
| 2 | Contacts and members | 1–1½ days |
| 3 | Signup and presets | ½ day |
| 4 | Template and weeks | 1½ days |
| 5 | Draft/publish and notify | 1 day |
| 6 | Staff link | 1 day |
| 7 | Texting, call-outs, reminders | 1½–2 days |
| 8 | Facility gating | ½ day |
| 9 | Docs and cleanup | ½ day |

Stages 0–6 are a working **Free/Pro product with email**. Stage 7 turns on texting, which is what Pro is sold on, so the frontend can start on the new screens after Stage 6 while Twilio registration (which takes days to approve) runs in parallel.

---

## 13. Endpoints the frontend will call (summary)

```
POST /auth/signup                     GET  /auth/me              POST /auth/login
POST /auth/forgot-password            POST /auth/reset-password  (also accepts invites)
POST /setup/facility-type             POST /setup/complete
GET|POST /facility-preferences        GET|PUT /staffing-template
GET  /weeks/:weekStart                GET  /weeks/:weekStart/candidates?coverageId=
POST /weeks/:weekStart/publish
POST|PUT|DELETE /coverage[/:id]       (one-off needs / per-day overrides)
POST|PUT|DELETE /schedules[/:id]      (assign / move / unassign; body.notify)
POST /schedules/:id/call-out          POST /coverage/:id/fill-by-text   GET /coverage/:id/callout
GET  /schedules/swap-requests         POST /schedules/swap-requests/:id/respond
GET  /timeoff                         PATCH /timeoff/:id/review
GET|POST /staff  POST /staff/bulk  POST /staff/import  PATCH /staff/:id
POST /staff/:id/archive|restore|send-link|rotate-link
GET  /members    POST /members/invite  PATCH|DELETE /members/:id  POST /members/:id/make-owner
POST /billing/start-trial
GET  /stripe/plans  POST /stripe/create-checkout-session  POST /stripe/change-plan  POST /stripe/portal
Staff link (no auth header): /s/:token/me, /schedule, /open-shifts, /open-shifts/pick-up,
  /swap-candidates/:scheduleId, /schedules/:id/swap, /swaps, /swaps/:id/respond,
  /schedules/:id/call-out, /time-off, /preferences, /messages, /clock-in, /clock-out, /breaks/*, /time-entries
Facility: /schedules/auto-generate, /schedules/draft-schedules/*, /time-tracking/*, /exports/*, /messages, /summary/admin/:id
```
