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
  ["post", "/auth/signup", "Auth", "Create a workspace (Free) and its owner", { auth: "none", body: { name: "Maria Okafor", facilityName: "Sunrise Care", email: "maria@example.com", password: "at-least-8", timezone: "America/New_York", termsAccepted: true } }],
  ["post", "/auth/login", "Auth", "Log in (accounts only; staff use their link)", { auth: "none", body: { email: "maria@example.com", password: "..." } }],
  ["post", "/auth/signup/tenant", "Auth", "Old signup path (same as /auth/signup; also accepts the old body)", { auth: "none" }],
  ["post", "/auth/login/staff", "Auth", "Old login path (same as /auth/login)", { auth: "none" }],
  ["get", "/auth/me", "Auth", "Current user, workspace, effective plan, limits and usage"],
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
  ["post", "/staff", "Staff", "Add a staff contact (name + phone or email). Sends nothing.", { body: { name: "Kim Tran", phone: "(555) 123-4567", email: "kim@example.com", roles: ["cna"], allowedShiftTypes: [], notes: "" } }],
  ["post", "/staff/bulk", "Staff", "Add many (paste from a list)", { body: { rows: [{ name: "Kim Tran", phone: "5551234567", role: "cna" }] } }],
  ["post", "/staff/import", "Staff", "Import a CSV (multipart field 'file')", { plan: "pro" }],
  ["get", "/staff/{id}", "Staff", "Get one"],
  ["patch", "/staff/{id}", "Staff", "Edit (changing the phone resets SMS consent)"],
  ["post", "/staff/{id}/archive", "Staff", "Archive: keeps history, removes future shifts, revokes link"],
  ["post", "/staff/{id}/restore", "Staff", "Restore (counts toward the plan limit)"],
  ["delete", "/staff/{id}", "Staff", "Delete (only if no history)"],
  ["get", "/staff/{id}/link", "Staff", "Their personal link"],
  ["post", "/staff/{id}/send-link", "Staff", "Text/email their link now"],
  ["post", "/staff/{id}/rotate-link", "Staff", "New link; old one stops working", { body: { send: true } }],

  // ── Members (accounts) ────────────────────────────────────────────────────
  ["get", "/members", "Members", "List owner, schedulers and viewers"],
  ["post", "/members/invite", "Members", "Invite a scheduler or viewer (viewers are free)", { body: { name: "Sam", email: "sam@example.com", role: "scheduler" } }],
  ["post", "/members/{id}/resend-invite", "Members", "Resend invite"],
  ["patch", "/members/{id}", "Members", "Change role", { body: { role: "viewer" } }],
  ["post", "/members/{id}/make-owner", "Members", "Transfer ownership"],
  ["delete", "/members/{id}", "Members", "Remove"],

  // ── Settings ──────────────────────────────────────────────────────────────
  ["get", "/facility-preferences", "Settings", "Facility settings (timezone, roles, shift times, rules)"],
  ["post", "/facility-preferences", "Settings", "Update facility settings", { body: { facilityTimezone: "America/New_York", weekStartsOn: 0, roleFamilies: ["cna", "lpn", "rn"] } }],
  ["delete", "/facility-preferences/reset", "Settings", "Reset to defaults"],
  ["get", "/staffing-template", "Schedule", "What a normal week needs"],
  ["put", "/staffing-template", "Schedule", "Save the template and re-apply it to upcoming weeks", { body: { applyTo: "unpublished", rules: [{ shiftType: "day", shiftTag: "day_1", role: "cna", countsByWeekday: [5, 6, 6, 6, 6, 6, 5] }] } }],

  // ── Weeks (the schedule screen) ───────────────────────────────────────────
  ["get", "/weeks/current", "Schedule", "This week's start date, previous and next"],
  ["get", "/weeks/{weekStart}", "Schedule", "Everything for one week: needs, shifts, staff, time off, counts"],
  ["get", "/weeks/{weekStart}/candidates", "Schedule", "Who can take a slot, eligible first, with reasons", { query: ["coverageId"] }],
  ["post", "/weeks/{weekStart}/publish", "Schedule", "Publish: one text/email per person; returns who wasn't reached", { body: { resendAll: false, includeEveryone: false } }],

  // ── Coverage (needs per day) ──────────────────────────────────────────────
  ["get", "/coverage", "Schedule", "List needs", { query: ["date", "month", "year", "role"] }],
  ["post", "/coverage", "Schedule", "Add one-off needs", { body: { dates: ["2026-10-20"], shifts: [{ role: "cna", shiftType: "day", shiftTag: "day_1", requiredCount: 1 }] } }],
  ["put", "/coverage/{id}", "Schedule", "Change one day's need (pins it against template edits)", { body: { requiredCount: 7 } }],
  ["delete", "/coverage/{id}", "Schedule", "Remove a need"],
  ["delete", "/coverage/bulk", "Schedule", "Remove many", { body: { ids: [] } }],
  ["get", "/coverage/unfilled", "Schedule", "Unfilled needs for a role", { query: ["role"] }],
  ["get", "/coverage/unfilled-auto", "Schedule", "Unfilled needs (for auto-fill)"],
  ["post", "/coverage/{id}/fill-by-text", "Call-outs", "Text eligible staff; first YES gets it", { plan: "pro", body: { staffIds: [] } }],
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
  ["post", "/schedules/auto-generate", "Auto-fill", "Auto-fill selected needs into a draft", { plan: "facility", body: { coverageIds: [] } }],
  ["get", "/schedules/draft-schedules", "Auto-fill", "Auto-fill drafts", { plan: "facility" }],
  ["get", "/schedules/draft-schedules/{draftId}", "Auto-fill", "One draft", { plan: "facility" }],
  ["patch", "/schedules/draft-schedules/{draftId}/assignments/{assignmentId}", "Auto-fill", "Edit a draft assignment", { plan: "facility" }],
  ["post", "/schedules/draft-schedules/{draftId}/assignments/{assignmentId}/fill-ai", "Auto-fill", "AI-fill one slot", { plan: "facility" }],
  ["post", "/schedules/draft-schedules/{draftId}/publish", "Auto-fill", "Put the draft on the schedule (still draft until the week is published)", { plan: "facility" }],
  ["post", "/schedules/draft-schedules/{draftId}/discard", "Auto-fill", "Discard", { plan: "facility" }],
  ["get", "/time-tracking", "Time clock", "Time entries", { plan: "facility" }],
  ["patch", "/time-tracking/{id}/adjust", "Time clock", "Fix a time entry", { plan: "facility" }],
  ["get", "/exports/payroll/{provider}", "Time clock", "Payroll CSV (gusto | quickbooks | rippling)", { plan: "facility", query: ["from", "to", "source"] }],
  ["get", "/exports/time-entries", "Time clock", "Time entries CSV", { plan: "facility", query: ["from", "to", "provider"] }],
  ["get", "/exports/schedules", "Time clock", "Scheduled hours CSV", { plan: "facility", query: ["from", "to", "provider"] }],
  ["get", "/messages", "Messages", "Messages", { plan: "facility" }],
  ["post", "/messages", "Messages", "Message staff (also delivered by text/email)", { plan: "facility", body: { receiverIds: [], subject: "Staff meeting", body: "Monday 2pm" } }],
  ["get", "/messages/receiver/{receiverId}", "Messages", "Inbox of one person (managers) or your own", { plan: "facility" }],
  ["get", "/messages/sender/{senderId}", "Messages", "Sent by one person (managers) or yourself", { plan: "facility" }],
  ["put", "/messages/{id}/read", "Messages", "Mark read (receiver only)", { plan: "facility" }],
  ["delete", "/messages/{id}", "Messages", "Delete", { plan: "facility" }],
  ["get", "/summary/admin/{adminId}", "Dashboard", "Dashboard numbers", { plan: "facility" }],
  ["get", "/summary/staff/{staffId}", "Dashboard", "One staff member's summary"],

  // ── Workspace & billing ───────────────────────────────────────────────────
  ["get", "/tenants/me", "Workspace", "Your workspace"],
  ["delete", "/tenants/{id}", "Workspace", "Delete your workspace and everything in it (owner)"],
  ["get", "/tenants/me/branding", "Workspace", "Branding"],
  ["patch", "/tenants/me/branding", "Workspace", "Update branding", { plan: "organization" }],
  ["put", "/tenants/me/logo", "Workspace", "Upload logo (multipart 'logo')", { plan: "organization" }],
  ["delete", "/tenants/me/logo", "Workspace", "Remove logo"],
  ["post", "/billing/start-trial", "Billing", "Start the one-time 14-day Pro trial (no card)"],
  ["get", "/stripe/plans", "Billing", "Plans, prices, your plan, trial and usage"],
  ["post", "/stripe/create-checkout-session", "Billing", "Stripe Checkout for Pro or Facility", { body: { plan: "pro", interval: "month" } }],
  ["post", "/stripe/change-plan", "Billing", "Switch plan / interval", { body: { plan: "facility", interval: "year" } }],
  ["post", "/stripe/portal", "Billing", "Stripe customer portal (invoices, card, cancel)"],
  ["post", "/stripe/cancel-subscription", "Billing", "Cancel (at period end by default)", { body: { atPeriodEnd: true } }],
  ["post", "/stripe/webhook", "Billing", "Stripe webhook", { auth: "none" }],

  // ── Staff link (no login) ─────────────────────────────────────────────────
  ["get", "/s/{token}/me", "Staff link", "Who I am, my facility, what's turned on", { auth: "link" }],
  ["get", "/s/{token}/schedule", "Staff link", "My published shifts", { auth: "link", query: ["weekStart", "weeks", "from", "to"] }],
  ["get", "/s/{token}/open-shifts", "Staff link", "Open shifts I can take", { auth: "link", plan: "pro" }],
  ["post", "/s/{token}/open-shifts/pick-up", "Staff link", "Take an open shift", { auth: "link", plan: "pro", body: { coverageId: "..." } }],
  ["get", "/s/{token}/swap-candidates/{scheduleId}", "Staff link", "Who could take my shift", { auth: "link", plan: "pro" }],
  ["post", "/s/{token}/schedules/{id}/swap", "Staff link", "Ask to swap", { auth: "link", plan: "pro", body: { receiverStaffId: "...", note: "" } }],
  ["get", "/s/{token}/swaps", "Staff link", "My swap requests", { auth: "link", plan: "pro", query: ["view"] }],
  ["post", "/s/{token}/swaps/{swapRequestId}/respond", "Staff link", "Accept / decline a swap", { auth: "link", plan: "pro", body: { decision: "accept" } }],
  ["post", "/s/{token}/schedules/{id}/call-out", "Staff link", "I can't make this shift", { auth: "link", body: { reason: "" } }],
  ["get", "/s/{token}/time-off", "Staff link", "My time-off requests", { auth: "link" }],
  ["post", "/s/{token}/time-off", "Staff link", "Request time off (whole days)", { auth: "link", body: { startDate: "2026-10-25", endDate: "2026-10-26", reason: "" } }],
  ["get", "/s/{token}/preferences", "Staff link", "My preferences", { auth: "link" }],
  ["post", "/s/{token}/preferences", "Staff link", "Save my preferences", { auth: "link" }],
  ["get", "/s/{token}/messages", "Staff link", "Messages to me", { auth: "link", plan: "facility" }],
  ["get", "/s/{token}/time-entries", "Staff link", "My time entries", { auth: "link", plan: "facility" }],
  ["post", "/s/{token}/clock-in", "Staff link", "Clock in", { auth: "link", plan: "facility" }],
  ["post", "/s/{token}/breaks/start", "Staff link", "Start break", { auth: "link", plan: "facility" }],
  ["post", "/s/{token}/breaks/end", "Staff link", "End break", { auth: "link", plan: "facility" }],
  ["post", "/s/{token}/clock-out", "Staff link", "Clock out", { auth: "link", plan: "facility" }],

  // ── Other ─────────────────────────────────────────────────────────────────
  ["post", "/sms/inbound", "Texting", "Twilio inbound webhook (START / STOP / YES / HELP)", { auth: "none" }],
  ["post", "/nl/parse", "Other", "Parse a natural-language form"],
  ["get", "/public/tenants/{tenantId}/logo", "Other", "Workspace logo image", { auth: "none" }],
  ["post", "/marketing/turnover-roi/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/cost-leak/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/call-out-cost/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/overtime-cost/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/payroll-accuracy/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
  ["post", "/marketing/time-clock-accuracy/email-summary", "Marketing", "Email a calculator summary", { auth: "none" }],
];

const PLAN_LABELS = { pro: "Pro", facility: "Facility", organization: "Organization" };

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
