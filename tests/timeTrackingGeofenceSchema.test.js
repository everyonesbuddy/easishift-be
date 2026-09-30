const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const FacilityPreferences = require("../models/facilityPreferencesModel");
const TimeEntry = require("../models/timeEntryModel");

test("facility preferences accept a configured geofence mode", () => {
  const preferences = new FacilityPreferences({
    tenantId: new mongoose.Types.ObjectId(),
    timeTracking: {
      enabled: true,
      mode: "geofence",
      geofence: {
        address: "1 Example Street",
        latitude: 40.7128,
        longitude: -74.006,
        radiusMeters: 200,
        maxAccuracyMeters: 40,
      },
    },
  });

  assert.equal(preferences.validateSync(), undefined);
});

test("facility geofence rejects out-of-range coordinates", () => {
  const preferences = new FacilityPreferences({
    tenantId: new mongoose.Types.ObjectId(),
    timeTracking: {
      mode: "geofence",
      geofence: {
        latitude: 91,
        longitude: -74,
        radiusMeters: 200,
        maxAccuracyMeters: 40,
      },
    },
  });

  assert.ok(preferences.validateSync().errors["timeTracking.geofence.latitude"]);
});

test("time entries accept geofence mode and punch location snapshots", () => {
  const entry = new TimeEntry({
    tenantId: new mongoose.Types.ObjectId(),
    staffId: new mongoose.Types.ObjectId(),
    clockInAt: new Date("2026-09-30T08:00:00.000Z"),
    mode: "geofence",
    clockInLocation: {
      latitude: 40.7128,
      longitude: -74.006,
      accuracyMeters: 12,
      distanceMeters: 3.2,
      result: "inside",
      verifiedAt: new Date("2026-09-30T08:00:01.000Z"),
    },
  });

  assert.equal(entry.validateSync(), undefined);
});