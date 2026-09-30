const EARTH_RADIUS_METERS = 6371000;

const isValidCoordinate = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

const getDistanceMeters = (first, second) => {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
};

const evaluateGeofenceLocation = ({ location, geofence, verifiedAt = new Date() }) => {
  const result = {
    accepted: false,
    status: "invalid",
    message: "A valid location is required",
    snapshot: {
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      distanceMeters: null,
      result: "invalid",
      verifiedAt,
    },
  };

  if (!location || typeof location !== "object") {
    result.status = "unavailable";
    result.message = "Device location is unavailable";
    result.snapshot.result = "unavailable";
    return result;
  }

  const { latitude, longitude, accuracyMeters } = location;
  if (
    !isValidCoordinate(latitude, longitude) ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters < 0
  ) {
    return result;
  }

  result.snapshot.latitude = latitude;
  result.snapshot.longitude = longitude;
  result.snapshot.accuracyMeters = accuracyMeters;

  if (accuracyMeters > geofence.maxAccuracyMeters) {
    result.status = "inaccurate";
    result.message = "Device location is not accurate enough";
    result.snapshot.result = result.status;
    return result;
  }

  const distanceMeters = getDistanceMeters(
    { latitude, longitude },
    { latitude: geofence.latitude, longitude: geofence.longitude },
  );
  result.snapshot.distanceMeters = Math.round(distanceMeters * 10) / 10;

  if (distanceMeters > geofence.radiusMeters) {
    result.status = "outside";
    result.message = "Device is outside the facility geofence";
    result.snapshot.result = result.status;
    return result;
  }

  result.accepted = true;
  result.status = "inside";
  result.message = "Device is inside the facility geofence";
  result.snapshot.result = result.status;
  return result;
};

const isGeofenceConfigured = (geofence) =>
  Boolean(
    geofence &&
      isValidCoordinate(geofence.latitude, geofence.longitude) &&
      Number.isFinite(geofence.radiusMeters) &&
      geofence.radiusMeters > 0 &&
      Number.isFinite(geofence.maxAccuracyMeters) &&
      geofence.maxAccuracyMeters > 0,
  );

module.exports = {
  evaluateGeofenceLocation,
  getDistanceMeters,
  isGeofenceConfigured,
};