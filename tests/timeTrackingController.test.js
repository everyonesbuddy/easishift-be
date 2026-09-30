const test = require("node:test");
const assert = require("node:assert/strict");

const controller = require("../controllers/timeTrackingController");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const TimeEntry = require("../models/timeEntryModel");

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

const mockGeofencePreferences = () => {
  const originalFindOne = FacilityPreferences.findOne;
  FacilityPreferences.findOne = () => ({
    select() {
      return this;
    },
    lean: async () => ({
      timeTracking: {
        enabled: true,
        mode: "geofence",
        geofence: {
          latitude: 40.7128,
          longitude: -74.006,
          radiusMeters: 150,
          maxAccuracyMeters: 50,
        },
      },
    }),
  });
  return () => {
    FacilityPreferences.findOne = originalFindOne;
  };
};

test("clock-in rejects a valid GPS location outside the facility radius", async () => {
  const restorePreferences = mockGeofencePreferences();
  const originalFindOne = TimeEntry.findOne;
  const originalCreate = TimeEntry.create;
  TimeEntry.findOne = async () => null;
  TimeEntry.create = async () => {
    assert.fail("outside-radius clock-in must not create a time entry");
  };

  try {
    const response = makeResponse();
    await controller.clockIn(
      {
        tenantId: "tenant-id",
        user: { _id: "staff-id" },
        body: {
          location: {
            latitude: 40.7142,
            longitude: -74.006,
            accuracyMeters: 12,
          },
        },
      },
      response,
      (error) => {
        throw error;
      },
    );

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.errorCode, "GEOFENCE_OUTSIDE");
  } finally {
    restorePreferences();
    TimeEntry.findOne = originalFindOne;
    TimeEntry.create = originalCreate;
  }
});

test("clock-out completes and records an outside-radius location result", async () => {
  const restorePreferences = mockGeofencePreferences();
  const originalFindOne = TimeEntry.findOne;
  const originalFindById = TimeEntry.findById;
  const clockInAt = new Date("2026-09-30T08:00:00.000Z");
  const clockOutAt = new Date("2026-09-30T16:00:00.000Z");
  const entry = {
    _id: "entry-id",
    tenantId: "tenant-id",
    staffId: "staff-id",
    scheduleId: null,
    clockInAt,
    clockOutAt: null,
    breaks: [],
    notes: "",
    save: async () => {},
  };
  TimeEntry.findOne = async () => entry;
  TimeEntry.findById = () => ({ populate: async () => entry });

  try {
    const response = makeResponse();
    await controller.clockOut(
      {
        tenantId: "tenant-id",
        user: { _id: "staff-id" },
        body: {
          at: clockOutAt,
          location: {
            latitude: 40.7142,
            longitude: -74.006,
            accuracyMeters: 12,
          },
        },
      },
      response,
      (error) => {
        throw error;
      },
    );

    assert.equal(response.statusCode, 200);
    assert.equal(entry.status, "completed");
    assert.equal(entry.clockOutLocation.result, "outside");
    assert.ok(entry.clockOutLocation.distanceMeters > 150);
  } finally {
    restorePreferences();
    TimeEntry.findOne = originalFindOne;
    TimeEntry.findById = originalFindById;
  }
});
