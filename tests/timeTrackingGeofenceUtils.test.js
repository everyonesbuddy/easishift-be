const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateGeofenceLocation,
  getDistanceMeters,
  isGeofenceConfigured,
} = require("../utils/timeTrackingGeofenceUtils");

const geofence = {
  latitude: 40.7128,
  longitude: -74.006,
  radiusMeters: 150,
  maxAccuracyMeters: 50,
};

test("accepts an accurate device location inside the facility radius", () => {
  const result = evaluateGeofenceLocation({
    location: {
      latitude: geofence.latitude,
      longitude: geofence.longitude,
      accuracyMeters: 12,
    },
    geofence,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.status, "inside");
  assert.equal(result.snapshot.distanceMeters, 0);
});

test("rejects a device location outside the facility radius", () => {
  const result = evaluateGeofenceLocation({
    location: {
      latitude: 40.7142,
      longitude: -74.006,
      accuracyMeters: 12,
    },
    geofence,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.status, "outside");
  assert.ok(result.snapshot.distanceMeters > geofence.radiusMeters);
});

test("rejects locations whose reported accuracy exceeds the configured limit", () => {
  const result = evaluateGeofenceLocation({
    location: {
      latitude: geofence.latitude,
      longitude: geofence.longitude,
      accuracyMeters: 51,
    },
    geofence,
  });

  assert.equal(result.status, "inaccurate");
  assert.equal(result.snapshot.result, "inaccurate");
});

test("marks a missing location as unavailable", () => {
  const result = evaluateGeofenceLocation({ location: null, geofence });

  assert.equal(result.status, "unavailable");
  assert.equal(result.snapshot.result, "unavailable");
});

test("rejects malformed coordinates and accuracy values", () => {
  for (const location of [
    { latitude: 91, longitude: 0, accuracyMeters: 10 },
    { latitude: 0, longitude: 181, accuracyMeters: 10 },
    { latitude: 0, longitude: 0, accuracyMeters: -1 },
    { latitude: "0", longitude: 0, accuracyMeters: 10 },
  ]) {
    assert.equal(
      evaluateGeofenceLocation({ location, geofence }).status,
      "invalid",
    );
  }
});

test("calculates zero distance for the same coordinates", () => {
  assert.equal(
    getDistanceMeters(
      { latitude: geofence.latitude, longitude: geofence.longitude },
      { latitude: geofence.latitude, longitude: geofence.longitude },
    ),
    0,
  );
});

test("requires valid facility coordinates and positive limits", () => {
  assert.equal(isGeofenceConfigured(geofence), true);
  assert.equal(isGeofenceConfigured({ ...geofence, latitude: 91 }), false);
  assert.equal(isGeofenceConfigured({ ...geofence, radiusMeters: 0 }), false);
});