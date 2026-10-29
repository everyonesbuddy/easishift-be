/**
 * OpenAPI spec for the WiserShifts API, served at /openapi.json and /api-docs.
 *
 * Built from the ROUTES table below so it stays short and easy to keep in
 * sync: [method, path, tag, summary, options].
 *   options.auth: "jwt" (default) | "link" (staff link token in the path) | "none"
 *   options.plan: the cheapest plan that has the feature (shown in the docs)
 *   options.body: example JSON request body
 *   options.query: query parameter names
 */

const ROUTES = [
  // ── Auth (accounts: owner / schedulers / viewers) ─────────────────────────
  ["post", "/auth/signup", "Auth", "Create a workspace (Free) and its owner", { auth: "none", body: { name: "Maria Okafor", facilityName: "Sunrise Care", email: "maria@example.com", password: "at-least-8", timezone: "America/New_York", termsAccepted: true, signupRole: "scheduler", heardAbout: "linkedin", signupSource: { utm_source: "linkedin", landingPage: "/for/schedulers", referrer: "https://www.linkedin.com/" } } }],
  ["post", "/auth/login", "Auth", "Log in (accounts only; staff use their link)", { auth: "none", body: { email: "maria@example.com", password: "..." } }],
  ["post", "/auth/signup/tenant", "Auth", "Old signup path (same as /auth/signup; also accepts the old body)", { auth: "none" }],
  ["post", "/auth/login/staff", "Auth", "Old login path (same as /auth/login)", { auth: "none" }],
  ["get", "/auth/me", "Auth", "Current user, workspace, effective plan, limits and usage"],
  ["patch", "/auth/me", "Auth", "Update my name, phone, profile picture or saved view filters (roles/areas I see on the week view and Weekly Needs; only the kinds sent change)", { body: { name: "Maria Okafor", viewFilters: { schedule: { roles: ["cna"], areas: ["memory_care"] } } } }],
  ["patch", "/auth/change-password", "Auth", "Change password", { body: { currentPassword: "...", newPassword: "..." } }],
  ["post", "/auth/forgot-password", "Auth", "Email a reset link", { auth: "none", body: { email: "maria@example.com" } }],
  ["post", "/auth/reset-password", "Auth", "Set a password from a reset or invite link", { auth: "none", body: { token: "...", newPassword: "..." } }],
  ["post", "/auth/users/{id}/send-password-reset", "Auth", "Owner sends a member a new password link"],

  // ── Onboarding ────────────────────────────────────────────────────────────
  ["get", "/setup/facility-types", "Setup", "Facility types and their default roles"],
  ["post", "/setup/facility-type", "Setup", "Apply a preset: roles, shift times, starting staffing template", { body: { facilityType: "skilled_nursing", overwrite: false } }],
  ["post", "/setup/complete", "Setup", "Mark onboarding done"],

  // ── Staff (contacts, no login) ────────────────────────────────────────────
  ["get", "/staff", "Staff", "List staff", { query: ["status", "q"] }],
  ["get", "/summary/today", "Summary", "Home page: open spots today and the next two days (with who's on them), call-outs, today's shifts and how full they are, who's on now, pending time off and swaps", {}],
  ["get", "/labor/report", "Labor", "One week or one month of labor for this building: hours staffed/needed/worked, hours per resident day vs budget, cost (owners/admins), overtime (per payroll week), call-outs and no-shows, open shifts, credentials expiring, turnover watch. ?weekStart=YYYY-MM-DD (default this week) or ?month=YYYY-MM. Paid plans.", { query: ["weekStart", "month"] }],
  ["get", "/labor/trends", "Labor", "One point per week for trend lines: hours per resident day, overtime hours, call-outs, no-shows, staffed/needed hours, cost (owners/admins)", { query: ["weeks", "endWeek"] }],
  ["get", "/labor/overtime/{staffId}/options", "Labor", "For someone heading into overtime: their shifts that week that haven't started, latest first, each with up to 5 qualified people who'd stay under the limit. Reassign with PUT /schedules/{id} { staffId }. Needs schedule.manage.", { query: ["weekStart"] }],
  ["post", "/labor/report/send", "Labor", "Email the Monday labor report now to owners, admins and extra recipients (owners/admins)", {}],
  ["get", "/labor/settings", "Labor", "Budget (hours per resident day), usual residents, daily resident counts, Monday email settings; pay rates for owners/admins", {}],
  ["put", "/labor/settings", "Labor", "Update pay rates (per role, per person), overtime multiplier, budget, usual residents, Monday email (owners/admins)", { body: { payRates: [{ role: "cna", hourlyRate: 18.5 }], budgetHoursPerResidentDay: 3.2, typicalCensus: 48, mondayReport: { enabled: true, extraRecipients: ["vp@example.com"] } } }],
  ["put", "/labor/census", "Labor", "Residents by day (null removes a day; it falls back to the usual number)", { body: { entries: [{ date: "2026-10-26", residents: 47 }] } }],
  ["post", "/staff", "Staff", "Add a staff contact (name + role; phone and email optional). Sends nothing.", { body: { name: "Kim Tran", phone: "(555) 123-4567", email: "kim@example.com", roles: ["cna"], allowedShiftTypes: [], notes: "" } }],
  ["post", "/staff/bulk", "Staff", "Add many (paste from a list)", { body: { rows: [{ name: "Kim Tran", phone: "5551234567", role: "cna" }] } }],
  ["post", "/staff/import", "Staff", "Import a CSV (multipart field 'file')", { plan: "starter" }],
  ["get", "/staff/{id}", "Staff", "Get one"],
  ["patch", "/staff/{id}", "Staff", "Edit (changing the phone resets SMS consent)"],
  ["post", "/staff/{id}/archive", "Staff", "Archive: keeps history, removes future shifts, revokes link"],
  ["post", "/staff/{id}/restore", "Staff", "Restore (counts toward the plan limit)"],
  ["delete", "/staff/{id}", "Staff", "Delete (only if no history)"],
  ["get", "/staff/{id}/link", "Staff", "Their personal link"],
  ["post", "/staff/{id}/send-link", "Staff", "Text/email their link now"],
  ["post", "/staff/{id}/reset-pin", "Staff", "Forget their link PIN and sign out all their devices"],
  ["post", "/staff/{id}/rotate-link", "Staff", "New link; old one stops working", { body: { send: true } }],

  // ── Members (accounts) ────────────────────────────────────────────────────
  ["get", "/members", "Members", "List owner, schedulers and viewers"],
  ["post", "/members/invite", "Members", "Invite an admin, scheduler or viewer (role: administrator | scheduler | viewer; viewers are free)", { body: { name: "Sam", email: "sam@example.com", role: "scheduler" } }],
  ["post", "/members/{id}/resend-invite", "Members", "Resend invite"],
  ["patch", "/members/{id}", "Members", "Change role", { body: { role: "viewer" } }],
  ["post", "/members/{id}/make-owner", "Members", "Transfer ownership (owner only)"],
  ["post", "/members/{id}/staff-profile", "Members", "Also put this member on the schedule (creates their staff contact)", { body: { role: "lpn", userPhone: "5551234567", userPhoneCountryCode: "+1" } }],
  ["delete", "/members/{id}", "Members", "Remove"],

  // ── Settings ──────────────────────────────────────────────────────────────
  ["get", "/facility-preferences", "Settings", "Facility settings (timezone, roles, shift times, rules)"],
  ["post", "/facility-preferences", "Settings", "Update facility settings", { body: { facilityTimezone: "America/New_York", weekStartsOn: 0, roleFamilies: ["cna", "lpn", "rn"] } }],
  ["delete", "/facility-preferences/reset", "Settings", "Reset to defaults"],
  ["get", "/staffing-template", "Schedule", "What a normal week needs"],
  ["put", "/staffing-template", "Schedule", "Save the template and re-apply it to upcoming weeks", { body: { applyTo: "unpublished", rules: [{ shiftType: "day", shiftTag: "day_1", role: "cna", unitArea: "memory care", requiredCertificationTags: ["med pass"], countsByWeekday: [5, 6, 6, 6, 6, 6, 5] }] } }],

  // ── Weeks (the schedule screen) ───────────────────────────────────────────
  ["get", "/weeks", "Schedule", "Summaries for every week in a range; opens each week (month/roster views)", { query: ["from", "to"] }],
  ["get", "/weeks/current", "Schedule", "This week's start date, previous and next"],
  ["get", "/weeks/{weekStart}", "Schedule", "Everything for one week: needs, shifts, staff, time off, counts"],
  ["get", "/weeks/{weekStart}/candidates", "Schedule", "Who can take a slot, eligible first, with reasons", { query: ["coverageId"] }],
  ["post", "/weeks/{weekStart}/publish", "Schedule", "Publish or send changes: one text/email per person; returns who wasn't reached. roles/areas publish only that section; the rest stays Not sent yet", { body: { roles: [], areas: [], resendAll: false, includeEveryone: false } }],
  ["post", "/weeks/{weekStart}/auto-fill", "Schedule", "Auto-fill open slots (Not sent yet). roles/areas fill only that section; keepLastWeek (default true) first puts last week's people back on the same Weekly Needs spots", { body: { roles: [], areas: [], keepLastWeek: true, coverageIds: [] } }],
  ["post", "/weeks/{weekStart}/slots", "Schedule", "Add a one-off need on one day (hand-edited, kept through template changes)", { body: { date: "2026-10-23", shiftType: "day", shiftTag: "day_1", role: "caregiver", unitArea: "memory care", requiredCertificationTags: [], count: 1 } }],

  // ── Coverage (needs per day) ──────────────────────────────────────────────
  ["get", "/coverage", "Schedule", "List needs", { query: ["date", "month", "year", "role"] }],
  ["post", "/coverage", "Schedule", "Add one-off needs", { body: { dates: ["2026-10-20"], shifts: [{ role: "cna", shiftType: "day", shiftTag: "day_1", requiredCount: 1 }] } }],
  ["put", "/coverage/{id}", "Schedule", "Change one day's need (pins it against template edits)", { body: { requiredCount: 7 } }],
  ["delete", "/coverage/{id}", "Schedule", "Remove a need"],
  ["delete", "/coverage/bulk", "Schedule", "Remove many", { body: { ids: [] } }],
  ["get", "/coverage/unfilled", "Schedule", "Unfilled needs for a role", { query: ["role"] }],
  ["get", "/coverage/unfilled-auto", "Schedule", "Unfilled needs (for auto-fill)"],
  ["post", "/coverage/{id}/fill-by-text", "Call-outs", "Text eligible staff; first YES gets it", { plan: "starter", body: { staffIds: [] } }],
  ["get", "/coverage/{id}/callout", "Call-outs", "Latest call-out offer and who answered"],

  // ── Shifts ────────────────────────────────────────────────────────────────
  ["get", "/schedules", "Schedule", "List shifts", { query: ["staffId", "from", "to", "status"] }],
  ["post", "/schedules", "Schedule", "Assign a shift (draft until the week is published)", { body: { staffId: "...", coverageId: "...", role: "cna", startTime: "2026-10-19T11:00:00.000Z", endTime: "2026-10-19T19:00:00.000Z", notify: true } }],
  ["get", "/schedules/{id}", "Schedule", "Get a shift"],
  ["put", "/schedules/{id}", "Schedule", "Move / reassign / change status (notifies if published, unless notify:false)"],
  ["delete", "/schedules/{id}", "Schedule", "Remove a shift"],
  ["delete", "/schedules/bulk", "Schedule", "Remove many", { body: { ids: [] } }],
  ["post", "/schedules/{id}/call-out", "Call-outs", "Mark someone out; returns who can cover", { body: { reason: "sick" } }],
  ["get", "/schedules/swap-requests", "Requests", "Swap requests"],
  ["post", "/schedules/swap-requests/{swapRequestId}/respond", "Requests", "Approve / deny a swap", { body: { decision: "approve" } }],
  ["post", "/schedules/{id}/swap-requests", "Requests", "Request a swap on someone's behalf", { body: { receiverStaffId: "..." } }],
  ["get", "/timeoff", "Requests", "Time-off requests"],
  ["post", "/timeoff", "Requests", "Request time off", { body: { startDate: "2026-10-25", endDate: "2026-10-26", reason: "" } }],
  ["patch", "/timeoff/{id}/review", "Requests", "Approve / deny time off", { body: { status: "approved" } }],
  ["get", "/preferences/{staffId}", "Staff", "A staff member's preferences"],
  ["post", "/preferences/{staffId}", "Staff", "Set a staff member's preferences"],

  // ── Facility plan ─────────────────────────────────────────────────────────
  ["post", "/schedules/auto-generate", "Auto-fill", "Auto-fill selected needs into a draft", { plan: "starter", body: { coverageIds: [] } }],
  ["get", "/schedules/draft-schedules", "Auto-fill", "Auto-fill drafts", { plan: "starter" }],
  ["get", "/schedules/draft-schedules/{draftId}", "Auto-fill", "One draft", { plan: "starter" }],
  ["patch", "/schedules/draft-schedules/{draftId}/assignments/{assignmentId}", "Auto-fill", "Edit a draft assignment", { plan: "starter" }],
  ["post", "/schedules/draft-schedules/{draftId}/assignments/{assignmentId}/fill-ai", "Auto-fill", "AI-fill one slot", { plan: "starter" }],
  ["post", "/schedules/draft-schedules/{draftId}/publish", "Auto-fill", "Put the draft on the schedule (still draft until the week is published)", { plan: "starter" }],
  ["post", "/schedules/draft-schedules/{draftId}/discard", "Auto-fill", "Discard", { plan: "starter" }],
  ["get", "/time-tracking", "Time clock", "Time entries", { plan: "starter" }],
  ["patch", "/time-tracking/{id}/adjust", "Time clock", "Fix a time entry", { plan: "starter" }],
  ["get", "/exports/payroll/{provider}", "Time clock", "Payroll CSV (gusto | quickbooks | rippling)", { plan: "starter", query: ["from", "to", "source"] }],
  ["get", "/exports/time-entries", "Time clock", "Time entries CSV", { plan: "starter", query: ["from", "to", "provider"] }],
  ["get", "/exports/schedules", "Time clock", "Scheduled hours CSV", { plan: "starter", query: ["from", "to", "provider"] }],
  ["get", "/messages", "Messages", "Messages", { plan: "starter" }],
  ["post", "/messages", "Messages", "Message staff (also delivered by text/email)", { plan: "starter", body: { receiverIds: [], subject: "Staff meeting", body: "Monday 2pm" } }],
  ["get", "/messages/receiver/{receiverId}", "Messages", "Inbox of one person (managers) or your own", { plan: "starter" }],
  ["get", "/messages/sender/{senderId}", "Messages", "Sent by one person (managers) or yourself", { plan: "starter" }],
  ["put", "/messages/{id}/read", "Messages", "Mark read (receiver only)", { plan: "starter" }],
  ["delete", "/messages/{id}", "Messages", "Delete", { plan: "starter" }],
  ["get", "/summary/admin/{adminId}", "Dashboard", "Dashboard numbers", { plan: "starter" }],
  ["get", "/summary/staff/{staffId}", "Dashboard", "One staff member's summary"],

  // ── Workspace & billing ───────────────────────────────────────────────────
  ["get", "/tenants/me", "Workspace", "Your workspace"],
  ["delete", "/tenants/{id}", "Workspace", "Delete your workspace and everything in it (owner)"],
  ["get", "/tenants/me/branding", "Workspace", "Branding"],
  ["patch", "/tenants/me/branding", "Workspace", "Update branding", { plan: "enterprise" }],
  ["put", "/tenants/me/logo", "Workspace", "Upload logo (multipart 'logo')", { plan: "enterprise" }],
  ["delete", "/tenants/me/logo", "Workspace", "Remove logo"],
  ["post", "/billing/start-trial", "Billing", "Start the one-time 14-day Starter trial (no card)"],
  ["post", "/billing/fit-to-plan", "Billing", "After a trial ends over the limits: keep these staff and schedulers, archive the rest / make them viewers", { body: { keepStaffIds: ["..."], keepSchedulerIds: [] } }],
  ["get", "/stripe/plans", "Billing", "Plans, prices, your plan, trial and usage"],
  ["post", "/stripe/create-checkout-session", "Billing", "Stripe Checkout for Starter, Growth or Premium (first checkout gets a 7-day monthly / 30-day yearly card trial)", { body: { plan: "starter", interval: "month" } }],
  ["post", "/stripe/change-plan", "Billing", "Switch plan / interval", { body: { plan: "growth", interval: "year" } }],
  ["post", "/stripe/portal", "Billing", "Stripe customer portal (invoices, card, cancel)"],
  ["post", "/stripe/cancel-subscription", "Billing", "Cancel (at period end by default)", { body: { atPeriodEnd: true } }],
  ["post", "/stripe/webhook", "Billing", "Stripe webhook", { auth: "none" }],

  // ── Staff link (no login) ─────────────────────────────────────────────────
  ["post", "/staff-link/request", "Staff link", "Send me my link: texts/emails the link to the phone or email on file (same answer whether found or not; 5 per 15 min)", { auth: "none", body: { contact: "+15551234567" } }],
  ["get", "/s/{token}/me", "Staff link", "Who I am, my facility, what's turned on", { auth: "link" }],
  ["post", "/s/{token}/pin/setup", "Staff link", "First time (PIN required): choose a 4-digit PIN; returns a device token", { auth: "link", body: { pin: "1234" } }],
  ["post", "/s/{token}/pin/verify", "Staff link", "New device: enter the PIN; returns a device token (5 tries, then 15-minute lock)", { auth: "link", body: { pin: "1234" } }],
  ["post", "/s/{token}/pin/sign-out", "Staff link", "Forget this device", { auth: "link" }],
  ["get", "/s/{token}/schedule", "Staff link", "My published shifts", { auth: "link", query: ["weekStart", "weeks", "from", "to"] }],
  ["get", "/s/{token}/open-shifts", "Staff link", "Open shifts I can take", { auth: "link", plan: "starter" }],
  ["post", "/s/{token}/open-shifts/pick-up", "Staff link", "Take an open shift", { auth: "link", plan: "starter", body: { coverageId: "..." } }],
  ["get", "/s/{token}/swap-candidates/{scheduleId}", "Staff link", "Who could take my shift", { auth: "link", plan: "starter" }],
  ["post", "/s/{token}/schedules/{id}/swap", "Staff link", "Ask to swap", { auth: "link", plan: "starter", body: { receiverStaffId: "...", note: "" } }],
  ["get", "/s/{token}/swaps", "Staff link", "My swap requests", { auth: "link", plan: "starter", query: ["view"] }],
  ["post", "/s/{token}/swaps/{swapRequestId}/respond", "Staff link", "Accept / decline a swap", { auth: "link", plan: "starter", body: { decision: "accept" } }],
  ["post", "/s/{token}/schedules/{id}/call-out", "Staff link", "I can't make this shift", { auth: "link", body: { reason: "" } }],
  ["get", "/s/{token}/time-off", "Staff link", "My time-off requests", { auth: "link" }],
  ["post", "/s/{token}/time-off", "Staff link", "Request time off (whole days)", { auth: "link", body: { startDate: "2026-10-25", endDate: "2026-10-26", reason: "" } }],
  ["get", "/s/{token}/preferences", "Staff link", "My preferences", { auth: "link" }],
  ["post", "/s/{token}/preferences", "Staff link", "Save my preferences", { auth: "link" }],
  ["get", "/s/{token}/messages", "Staff link", "Messages to me", { auth: "link", plan: "starter" }],
  ["get", "/s/{token}/time-entries", "Staff link", "My time entries", { auth: "link", plan: "starter" }],
  ["post", "/s/{token}/clock-in", "Staff link", "Clock in", { auth: "link", plan: "starter" }],
  ["post", "/s/{token}/breaks/start", "Staff link", "Start break", { auth: "link", plan: "starter" }],
  ["post", "/s/{token}/breaks/end", "Staff link", "End break", { auth: "link", plan: "starter" }],
  ["post", "/s/{token}/clock-out", "Staff link", "Clock out", { auth: "link", plan: "starter" }],

  // ── Other ─────────────────────────────────────────────────────────────────
  ["post", "/sms/inbound", "Texting", "Twilio inbound webhook (START / STOP / YES / HELP)", { auth: "none" }],
  ["post", "/nl/parse", "Other", "Parse a natural-language form"],
  ["get", "/public/tenants/{tenantId}/logo", "Other", "Workspace logo image", { auth: "none" }],
  ["get", "/public/blog", "Other", "Published blog posts from Contentful (newest first); ?audience=schedulers|directors|operators", { auth: "none", query: ["audience"] }],
  ["get", "/public/blog/{slug}", "Other", "One blog post with its rich-text body", { auth: "none" }],
  ["post", "/marketing/turnover-roi/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/cost-leak/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/call-out-cost/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/overtime-cost/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/payroll-accuracy/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/time-clock-accuracy/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/lead", "Marketing", "Save an email from a calculator, the blog or newsletter form (HQ + Klaviyo; joins the newsletter list only with newsletter: true)", { auth: "none", body: { email: "maria@example.com", source: "hours-per-resident-day", company: "Sunrise Care", summary: "3.4 hours per resident day", newsletter: true, utm: { utm_source: "linkedin" } } }],

  // ── HQ (WiserShifts' own team; separate HQ accounts and sign-in, Bearer HQ token) ──
  ["post", "/hq/auth/login", "HQ", "Sign in to HQ (HQ accounts only; workspace logins don't work here). Returns an HQ token for the Authorization header.", { auth: "none", body: { email: "joseph@wisershifts.com", password: "..." } }],
  ["get", "/hq/auth/me", "HQ", "The signed-in HQ account"],
  ["post", "/hq/auth/change-password", "HQ", "Change your HQ password (12+ characters)", { body: { currentPassword: "...", newPassword: "..." } }],
  ["get", "/hq/access", "HQ", "Whether you can open HQ"],
  ["get", "/hq/overview", "HQ", "Counts: facilities, people by role, signups, email clicks, leads, top plays, connections"],
  ["get", "/hq/connections", "HQ", "Each outside source: connected or not, which env vars it needs, last sync, last error"],
  ["get", "/hq/plays", "HQ", "Next plays: who to reach and why (signups stuck in setup, leadership not reached, upgrade, real email clicks, groups with 2+ engaged buildings, call-list follow-ups)", { query: ["role", "kind"] }],
  ["post", "/hq/plays/done", "HQ", "Mark a play done (hidden until the facts change)", { body: { key: "clicked:66f…:3", outcome: "Emailed", notes: "" } }],
  ["get", "/hq/facilities", "HQ", "Facilities we market to, with contacts and real email clicks", { query: ["q", "tier", "stage", "state", "group", "customers", "sort", "page", "limit"] }],
  ["post", "/hq/facilities", "HQ", "Add a facility", { body: { name: "Sunrise Care", city: "Dayton", state: "OH", group: "Sunrise Senior Living", tier: 2 } }],
  ["get", "/hq/facilities/{id}", "HQ", "One facility: contacts (with email signals), people at the group, activity, its workspace if it signed up, sister buildings"],
  ["patch", "/hq/facilities/{id}", "HQ", "Update a facility", { body: { stage: "Got scheduler name", nextDate: "2026-11-02" } }],
  ["get", "/hq/contacts", "HQ", "People (executives mostly) with email signals", { query: ["q", "role", "group", "engaged", "page", "limit"] }],
  ["post", "/hq/contacts", "HQ", "Add a person", { body: { name: "Dana Lee", title: "Director of Nursing", email: "dana@example.com", facilityId: "…" } }],
  ["patch", "/hq/contacts/{id}", "HQ", "Update a person"],
  ["get", "/hq/activities", "HQ", "Recent calls, emails and notes", { query: ["facilityId", "contactId", "limit"] }],
  ["post", "/hq/activities", "HQ", "Log a call, email, LinkedIn touch, meeting or note; also updates the facility's attempts, last call, next date and stage", { body: { facilityId: "…", kind: "call", outcome: "Voicemail", nextDate: "2026-11-03", nextStep: "Call back", stage: "Trying (no answer / voicemail)" } }],
  ["post", "/hq/import/{kind}", "HQ", "Import a CSV (multipart field 'file', or { csv }): facilities (call-list tiers), contacts (Lead Bank), activities (Outreach), linkedin (post analytics export). dryRun=1 previews.", { query: ["dryRun", "tier"] }],
  ["get", "/hq/signups", "HQ", "Every workspace with how it's doing (setup, active, leadership reached, plan, trial, signup answers) and recent calculator leads"],
  ["get", "/hq/content", "HQ", "Blog posts (Contentful, with GA4 views), YouTube channel and videos, LinkedIn posts", { query: ["refresh"] }],
  ["get", "/hq/web", "HQ", "Website (GA4) and Google search (Search Console), last 28 days", { query: ["refresh"] }],
  ["get", "/hq/email", "HQ", "Klaviyo: delivered, real clicks vs scanner clicks, top clickers matched to people"],
  ["post", "/hq/sync/klaviyo", "HQ", "Pull new Klaviyo email events now (also runs hourly)"],
];

const PLAN_LABELS = { starter: "Starter (or the free trial)", enterprise: "Enterprise" };

const pathParams = (path) =>
  [...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));

const buildOperation = ([method, path, tag, summary, options = {}]) => {
  const auth = options.auth || "jwt";
  const notes = [];
  if (options.plan) notes.push(`Requires the ${PLAN_LABELS[options.plan]} plan (402 PLAN_FEATURE_REQUIRED otherwise).`);
  if (auth === "link") notes.push("No login: `token` is the staff member's personal link token.");

  const operation = {
    tags: [tag],
    summary,
    ...(notes.length ? { description: notes.join(" ") } : {}),
    parameters: [
      ...pathParams(path),
      ...(options.query || []).map((name) => ({ name, in: "query", schema: { type: "string" } })),
    ],
    responses: {
      200: { description: "OK" },
      400: { $ref: "#/components/responses/Error" },
      402: { $ref: "#/components/responses/Error" },
      404: { $ref: "#/components/responses/Error" },
    },
    ...(auth === "jwt" ? { security: [{ bearerAuth: [] }] } : { security: [] }),
  };
  if (options.body) {
    operation.requestBody = {
      required: true,
      content: { "application/json": { schema: { type: "object" }, example: options.body } },
    };
  }
  return operation;
};

const buildOpenApiSpec = () => {
  const serverUrl = process.env.API_BASE_URL || "http://localhost:5000";
  const paths = {};
  for (const route of ROUTES) {
    const [method, path] = route;
    const fullPath = `/api/v1${path}`;
    paths[fullPath] = paths[fullPath] || {};
    paths[fullPath][method] = buildOperation(route);
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "WiserShifts API",
      version: "2.0.0",
      description:
        "Scheduler-first scheduling for care facilities. Accounts (owner, schedulers, viewers) use a JWT; staff never log in and use their personal link (/s/{token}). Plan limits return 402 with errorCode PLAN_FEATURE_REQUIRED, PLAN_LIMIT_REACHED or OVER_PLAN_LIMIT and a trialAvailable flag.",
    },
    servers: [{ url: serverUrl }],
    tags: [...new Set(ROUTES.map((route) => route[2]))].map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            message: { type: "string" },
            errorCode: { type: "string" },
            trialAvailable: { type: "boolean" },
          },
        },
      },
      responses: {
        Error: {
          description: "Error",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
        },
      },
    },
    paths,
  };
};

module.exports = buildOpenApiSpec;
module.exports.ROUTES = ROUTES;
