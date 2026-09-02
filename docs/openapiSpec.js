const buildOpenApiSpec = () => {
  const serverUrl = process.env.API_BASE_URL || "http://localhost:5000";

  const idParam = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
  };

  return {
    openapi: "3.0.3",
    info: {
      title: "WiserShifts API",
      version: "1.0.0",
      description:
        "Backend API for workforce scheduling, coverage, messaging, time tracking, and tenant operations.",
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: "Auth" },
      { name: "Users" },
      { name: "Schedules" },
      { name: "Coverage" },
      { name: "Time Off" },
      { name: "Time Tracking" },
      { name: "Preferences" },
      { name: "Facility Preferences" },
      { name: "Messages" },
      { name: "Summary" },
      { name: "Tenant" },
      { name: "Billing" },
      { name: "Marketing" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            message: { type: "string" },
            errorCode: { type: "string" },
            details: { type: "string" },
          },
        },
        MessageResponse: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
        },
        User: {
          type: "object",
          properties: {
            _id: { type: "string" },
            tenantId: { type: "string" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
            role: { type: "string" },
            roles: {
              type: "array",
              items: { type: "string" },
            },
            permissions: {
              type: "array",
              items: { type: "string" },
            },
            allowedAreas: {
              type: "array",
              items: { type: "string" },
            },
            allowedShiftTypes: {
              type: "array",
              items: { type: "string" },
            },
            certificationTags: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        Tenant: {
          type: "object",
          properties: {
            _id: { type: "string" },
            name: { type: "string" },
            email: { type: "string", format: "email" },
          },
        },
        Coverage: {
          type: "object",
          properties: {
            _id: { type: "string" },
            tenantId: { type: "string" },
            role: { type: "string" },
            unitArea: { type: "string", nullable: true },
            shiftType: { type: "string", nullable: true },
            shiftTag: { type: "string", nullable: true },
            startTime: { type: "string", format: "date-time" },
            endTime: { type: "string", format: "date-time" },
            requiredCount: { type: "number" },
            requiredCertificationTags: {
              type: "array",
              items: { type: "string" },
            },
            assignedCount: { type: "number" },
            remaining: { type: "number" },
            spansOvernight: { type: "boolean" },
          },
        },
        Schedule: {
          type: "object",
          properties: {
            _id: { type: "string" },
            tenantId: { type: "string" },
            staffId: { type: "string" },
            role: { type: "string" },
            unitArea: { type: "string", nullable: true },
            shiftType: { type: "string", nullable: true },
            shiftTag: { type: "string", nullable: true },
            certificationTags: {
              type: "array",
              items: { type: "string" },
            },
            startTime: { type: "string", format: "date-time" },
            endTime: { type: "string", format: "date-time" },
            status: { type: "string" },
            notes: { type: "string", nullable: true },
          },
        },
        TimeOff: {
          type: "object",
          properties: {
            _id: { type: "string" },
            staffId: { type: "string" },
            status: { type: "string" },
            start: { type: "string", format: "date-time" },
            end: { type: "string", format: "date-time" },
          },
        },
        Preferences: {
          type: "object",
          properties: {
            _id: { type: "string" },
            staffId: { type: "string" },
            emailNotificationsEnabled: { type: "boolean" },
            smsNotificationsEnabled: { type: "boolean" },
          },
        },
        ShiftSwap: {
          type: "object",
          properties: {
            _id: { type: "string" },
            status: { type: "string" },
            requesterStaffId: { type: "string" },
            receiverStaffId: { type: "string" },
            scheduleId: { type: "string" },
            role: { type: "string" },
          },
        },
        TimeEntry: {
          type: "object",
          properties: {
            _id: { type: "string" },
            staffId: { type: "string" },
            scheduleId: { type: "string", nullable: true },
            status: { type: "string" },
            clockInAt: { type: "string", format: "date-time" },
            clockOutAt: { type: "string", format: "date-time", nullable: true },
          },
        },
      },
    },
    paths: {
      "/api/v1/auth/signup/tenant": {
        post: {
          tags: ["Auth"],
          summary: "Register tenant and owner",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: {
            200: { description: "Tenant created" },
            400: { description: "Validation error" },
          },
        },
      },
      "/api/v1/auth/signup/staff": {
        post: {
          tags: ["Auth", "Users"],
          security: [{ bearerAuth: [] }],
          summary: "Register staff member",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: {
            201: { description: "Staff created" },
            403: { description: "Forbidden" },
          },
        },
      },
      "/api/v1/auth/signup/staff/bulk": {
        post: {
          tags: ["Auth", "Users"],
          security: [{ bearerAuth: [] }],
          summary: "Bulk register staff",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": { schema: { type: "object" } },
              "application/json": { schema: { type: "object" } },
            },
          },
          responses: { 200: { description: "Bulk import result" } },
        },
      },
      "/api/v1/auth/login/staff": {
        post: {
          tags: ["Auth"],
          summary: "Login staff",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: {
            200: { description: "Login success" },
            401: { description: "Invalid credentials" },
          },
        },
      },
      "/api/v1/auth/change-password": {
        patch: {
          tags: ["Auth"],
          security: [{ bearerAuth: [] }],
          summary: "Change password",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Password changed" } },
        },
      },
      "/api/v1/auth/forgot-password": {
        post: {
          tags: ["Auth"],
          summary: "Send forgot password link",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Handled" } },
        },
      },
      "/api/v1/auth/reset-password": {
        post: {
          tags: ["Auth"],
          summary: "Reset password with token",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Password reset" } },
        },
      },
      "/api/v1/auth/users/{id}/send-password-reset": {
        post: {
          tags: ["Auth", "Users"],
          security: [{ bearerAuth: [] }],
          summary: "Admin send password reset",
          parameters: [idParam],
          responses: { 200: { description: "Reset sent" } },
        },
      },
      "/api/v1/auth/users": {
        get: {
          tags: ["Users"],
          security: [{ bearerAuth: [] }],
          summary: "Get users",
          responses: {
            200: {
              description: "Users",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/User" },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/auth/users/directory": {
        get: {
          tags: ["Users", "Scheduling"],
          security: [{ bearerAuth: [] }],
          summary: "Get tenant staff directory for shift swaps",
          responses: {
            200: {
              description: "Minimal staff profiles for compatible swap selection",
            },
          },
        },
      },
      "/api/v1/auth/{id}": {
        get: {
          tags: ["Users"],
          security: [{ bearerAuth: [] }],
          summary: "Get user by id",
          parameters: [idParam],
          responses: {
            200: { description: "User" },
            404: { description: "Not found" },
          },
        },
        put: {
          tags: ["Users"],
          security: [{ bearerAuth: [] }],
          summary: "Update user",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Updated" } },
        },
        delete: {
          tags: ["Users"],
          security: [{ bearerAuth: [] }],
          summary: "Delete user",
          parameters: [idParam],
          responses: { 200: { description: "Deleted" } },
        },
      },

      "/api/v1/schedules": {
        get: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "List schedules",
          responses: { 200: { description: "Schedules" } },
        },
        post: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Create schedule",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 201: { description: "Created" } },
        },
      },
      "/api/v1/schedules/open-for-me": {
        get: {
          tags: ["Schedules", "Coverage"],
          security: [{ bearerAuth: [] }],
          summary: "Get open coverage for current staff",
          responses: { 200: { description: "Open coverage list" } },
        },
      },
      "/api/v1/schedules/pick-up": {
        post: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Pick up open shift",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 201: { description: "Shift picked up" } },
        },
      },
      "/api/v1/schedules/auto-generate": {
        post: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Auto-generate draft schedule",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Draft generated" } },
        },
      },
      "/api/v1/schedules/draft-schedules": {
        get: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "List auto-schedule drafts",
          responses: { 200: { description: "Drafts" } },
        },
      },
      "/api/v1/schedules/draft-schedules/{draftId}": {
        get: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Get draft by id",
          parameters: [
            {
              name: "draftId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 200: { description: "Draft" } },
        },
      },
      "/api/v1/schedules/draft-schedules/{draftId}/assignments/{assignmentId}":
        {
          patch: {
            tags: ["Schedules"],
            security: [{ bearerAuth: [] }],
            summary: "Update draft assignment",
            parameters: [
              {
                name: "draftId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "assignmentId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: { "application/json": { schema: { type: "object" } } },
            },
            responses: { 200: { description: "Updated" } },
          },
        },
      "/api/v1/schedules/draft-schedules/{draftId}/assignments/{assignmentId}/fill-ai":
        {
          post: {
            tags: ["Schedules"],
            security: [{ bearerAuth: [] }],
            summary: "Fill draft assignment with AI",
            parameters: [
              {
                name: "draftId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
              {
                name: "assignmentId",
                in: "path",
                required: true,
                schema: { type: "string" },
              },
            ],
            responses: { 200: { description: "Filled" } },
          },
        },
      "/api/v1/schedules/draft-schedules/{draftId}/publish": {
        post: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Publish draft schedule",
          parameters: [
            {
              name: "draftId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: false,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Published" } },
        },
      },
      "/api/v1/schedules/draft-schedules/{draftId}/discard": {
        post: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Discard draft schedule",
          parameters: [
            {
              name: "draftId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 200: { description: "Discarded" } },
        },
      },
      "/api/v1/schedules/swap-requests": {
        get: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "List swap requests",
          responses: { 200: { description: "Swap requests" } },
        },
      },
      "/api/v1/schedules/swap-requests/{swapRequestId}/respond": {
        post: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Respond to swap request",
          parameters: [
            {
              name: "swapRequestId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Responded" } },
        },
      },
      "/api/v1/schedules/{id}/swap-requests": {
        post: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Request shift swap for schedule",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 201: { description: "Requested" } },
        },
      },
      "/api/v1/schedules/{id}/status": {
        patch: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Update own schedule status",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Status updated" } },
        },
      },
      "/api/v1/schedules/bulk": {
        delete: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Delete schedules by ids",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Deleted" } },
        },
      },
      "/api/v1/schedules/{id}": {
        get: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Get schedule by id",
          parameters: [idParam],
          responses: { 200: { description: "Schedule" } },
        },
        put: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Update schedule",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Updated" } },
        },
        delete: {
          tags: ["Schedules"],
          security: [{ bearerAuth: [] }],
          summary: "Delete schedule",
          parameters: [idParam],
          responses: { 200: { description: "Deleted" } },
        },
      },

      "/api/v1/coverage": {
        get: {
          tags: ["Coverage"],
          security: [{ bearerAuth: [] }],
          summary: "List coverage",
          responses: { 200: { description: "Coverage list" } },
        },
        post: {
          tags: ["Coverage"],
          security: [{ bearerAuth: [] }],
          summary: "Create coverage",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 201: { description: "Created" } },
        },
      },
      "/api/v1/coverage/unfilled": {
        get: {
          tags: ["Coverage"],
          security: [{ bearerAuth: [] }],
          summary: "Get unfilled coverage",
          responses: { 200: { description: "Unfilled coverage" } },
        },
      },
      "/api/v1/coverage/unfilled-auto": {
        get: {
          tags: ["Coverage"],
          security: [{ bearerAuth: [] }],
          summary: "Get unfilled coverage for auto-scheduler",
          responses: { 200: { description: "Unfilled coverage" } },
        },
      },
      "/api/v1/coverage/bulk": {
        delete: {
          tags: ["Coverage"],
          security: [{ bearerAuth: [] }],
          summary: "Delete coverage by ids",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Deleted" } },
        },
      },
      "/api/v1/coverage/{id}": {
        put: {
          tags: ["Coverage"],
          security: [{ bearerAuth: [] }],
          summary: "Update coverage",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Updated" } },
        },
        delete: {
          tags: ["Coverage"],
          security: [{ bearerAuth: [] }],
          summary: "Delete coverage",
          parameters: [idParam],
          responses: { 200: { description: "Deleted" } },
        },
      },

      "/api/v1/timeoff": {
        get: {
          tags: ["Time Off"],
          security: [{ bearerAuth: [] }],
          summary: "List time off",
          responses: { 200: { description: "Time off list" } },
        },
        post: {
          tags: ["Time Off"],
          security: [{ bearerAuth: [] }],
          summary: "Request time off",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 201: { description: "Requested" } },
        },
      },
      "/api/v1/timeoff/{id}/review": {
        patch: {
          tags: ["Time Off"],
          security: [{ bearerAuth: [] }],
          summary: "Review time off request",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Reviewed" } },
        },
      },

      "/api/v1/time-tracking/me": {
        get: {
          tags: ["Time Tracking"],
          security: [{ bearerAuth: [] }],
          summary: "Get my time entries",
          responses: { 200: { description: "Entries" } },
        },
      },
      "/api/v1/time-tracking/clock-in": {
        post: {
          tags: ["Time Tracking"],
          security: [{ bearerAuth: [] }],
          summary: "Clock in",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Clocked in" } },
        },
      },
      "/api/v1/time-tracking/breaks/start": {
        post: {
          tags: ["Time Tracking"],
          security: [{ bearerAuth: [] }],
          summary: "Start break",
          requestBody: {
            required: false,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Break started" } },
        },
      },
      "/api/v1/time-tracking/breaks/end": {
        post: {
          tags: ["Time Tracking"],
          security: [{ bearerAuth: [] }],
          summary: "End break",
          requestBody: {
            required: false,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Break ended" } },
        },
      },
      "/api/v1/time-tracking/clock-out": {
        post: {
          tags: ["Time Tracking"],
          security: [{ bearerAuth: [] }],
          summary: "Clock out",
          requestBody: {
            required: false,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Clocked out" } },
        },
      },
      "/api/v1/time-tracking/qr-token/current": {
        get: {
          tags: ["Time Tracking"],
          security: [{ bearerAuth: [] }],
          summary: "Get current QR token",
          responses: { 200: { description: "Token" } },
        },
      },
      "/api/v1/time-tracking/qr-token": {
        post: {
          tags: ["Time Tracking"],
          security: [{ bearerAuth: [] }],
          summary: "Generate QR token",
          requestBody: {
            required: false,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Generated" } },
        },
      },
      "/api/v1/time-tracking": {
        get: {
          tags: ["Time Tracking"],
          security: [{ bearerAuth: [] }],
          summary: "List time entries (admin)",
          responses: { 200: { description: "Entries" } },
        },
      },
      "/api/v1/time-tracking/{id}/adjust": {
        patch: {
          tags: ["Time Tracking"],
          security: [{ bearerAuth: [] }],
          summary: "Adjust time entry",
          parameters: [idParam],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Adjusted" } },
        },
      },

      "/api/v1/preferences/me": {
        get: {
          tags: ["Preferences"],
          security: [{ bearerAuth: [] }],
          summary: "Get my preferences",
          responses: { 200: { description: "Preferences" } },
        },
        post: {
          tags: ["Preferences"],
          security: [{ bearerAuth: [] }],
          summary: "Upsert my preferences",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Saved" } },
        },
      },
      "/api/v1/preferences/{staffId}": {
        get: {
          tags: ["Preferences"],
          security: [{ bearerAuth: [] }],
          summary: "Get preferences for staff",
          parameters: [
            {
              name: "staffId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 200: { description: "Preferences" } },
        },
        post: {
          tags: ["Preferences"],
          security: [{ bearerAuth: [] }],
          summary: "Upsert preferences for staff",
          parameters: [
            {
              name: "staffId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Saved" } },
        },
      },

      "/api/v1/facility-preferences": {
        get: {
          tags: ["Facility Preferences"],
          security: [{ bearerAuth: [] }],
          summary: "Get facility preferences",
          responses: { 200: { description: "Preferences" } },
        },
        post: {
          tags: ["Facility Preferences"],
          security: [{ bearerAuth: [] }],
          summary: "Upsert facility preferences",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Saved" } },
        },
      },
      "/api/v1/facility-preferences/reset": {
        delete: {
          tags: ["Facility Preferences"],
          security: [{ bearerAuth: [] }],
          summary: "Reset facility preferences",
          responses: { 200: { description: "Reset" } },
        },
      },

      "/api/v1/messages": {
        get: {
          tags: ["Messages"],
          security: [{ bearerAuth: [] }],
          summary: "List messages",
          responses: { 200: { description: "Messages" } },
        },
        post: {
          tags: ["Messages"],
          security: [{ bearerAuth: [] }],
          summary: "Create message",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 201: { description: "Created" } },
        },
      },
      "/api/v1/messages/receiver/{receiverId}": {
        get: {
          tags: ["Messages"],
          security: [{ bearerAuth: [] }],
          summary: "List messages by receiver",
          parameters: [
            {
              name: "receiverId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 200: { description: "Messages" } },
        },
      },
      "/api/v1/messages/sender/{senderId}": {
        get: {
          tags: ["Messages"],
          security: [{ bearerAuth: [] }],
          summary: "List messages by sender",
          parameters: [
            {
              name: "senderId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 200: { description: "Messages" } },
        },
      },
      "/api/v1/messages/{id}/read": {
        put: {
          tags: ["Messages"],
          security: [{ bearerAuth: [] }],
          summary: "Mark message read",
          parameters: [idParam],
          responses: { 200: { description: "Updated" } },
        },
      },
      "/api/v1/messages/{id}": {
        delete: {
          tags: ["Messages"],
          security: [{ bearerAuth: [] }],
          summary: "Delete message",
          parameters: [idParam],
          responses: { 200: { description: "Deleted" } },
        },
      },

      "/api/v1/summary/admin/{adminId}": {
        get: {
          tags: ["Summary"],
          security: [{ bearerAuth: [] }],
          summary: "Get admin summary",
          parameters: [
            {
              name: "adminId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 200: { description: "Summary" } },
        },
      },
      "/api/v1/summary/staff/{staffId}": {
        get: {
          tags: ["Summary"],
          security: [{ bearerAuth: [] }],
          summary: "Get staff summary",
          parameters: [
            {
              name: "staffId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 200: { description: "Summary" } },
        },
      },

      "/api/v1/tenants": {
        get: {
          tags: ["Tenant"],
          security: [{ bearerAuth: [] }],
          summary: "List tenants",
          responses: { 200: { description: "Tenants" } },
        },
        post: {
          tags: ["Tenant"],
          security: [{ bearerAuth: [] }],
          summary: "Create tenant",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 201: { description: "Created" } },
        },
      },
      "/api/v1/tenants/{id}": {
        get: {
          tags: ["Tenant"],
          security: [{ bearerAuth: [] }],
          summary: "Get tenant by id",
          parameters: [idParam],
          responses: { 200: { description: "Tenant" } },
        },
        delete: {
          tags: ["Tenant"],
          security: [{ bearerAuth: [] }],
          summary: "Delete tenant account",
          parameters: [idParam],
          responses: { 200: { description: "Deleted" } },
        },
      },

      "/api/v1/stripe/webhook": {
        post: {
          tags: ["Billing"],
          summary: "Stripe webhook",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Webhook accepted" } },
        },
      },
      "/api/v1/stripe/create-checkout-session": {
        post: {
          tags: ["Billing"],
          security: [{ bearerAuth: [] }],
          summary: "Create checkout session",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Session created" } },
        },
      },
      "/api/v1/stripe/cancel-subscription": {
        post: {
          tags: ["Billing"],
          security: [{ bearerAuth: [] }],
          summary: "Cancel subscription",
          requestBody: {
            required: false,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Cancelled" } },
        },
      },

      "/api/v1/marketing/turnover-roi/email-summary": {
        post: {
          tags: ["Marketing"],
          summary: "Send turnover ROI summary",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Sent" } },
        },
      },
      "/api/v1/marketing/cost-leak/email-summary": {
        post: {
          tags: ["Marketing"],
          summary: "Send cost leak summary",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { 200: { description: "Sent" } },
        },
      },
    },
  };
};

module.exports = buildOpenApiSpec;
