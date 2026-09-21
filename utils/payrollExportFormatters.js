const {
  formatIsoDate,
  formatIsoTime,
  minutesBetween,
  minutesToHours,
  rowsToCsv,
} = require("./csvUtils");

const PROVIDERS = new Set(["gusto", "quickbooks", "rippling"]);

const getStaff = (record) => record.staffId || {};

const getSchedule = (record) => record.scheduleId || record;

const getActualMinutes = (entry) => {
  if (entry?.totals?.workedMinutes !== null && entry?.totals?.workedMinutes !== undefined) {
    return entry.totals.workedMinutes;
  }
  return minutesBetween(entry.clockInAt, entry.clockOutAt);
};

const getScheduledMinutes = (schedule) => minutesBetween(schedule.startTime, schedule.endTime);

const getRole = (record) => {
  const schedule = getSchedule(record);
  return schedule.role || record.role || "";
};

const getUnitArea = (record) => {
  const schedule = getSchedule(record);
  return schedule.unitArea || record.unitArea || "";
};

const normalizeProvider = (provider) => {
  const normalized = String(provider || "").trim().toLowerCase();
  return PROVIDERS.has(normalized) ? normalized : null;
};

const formatGustoRows = (records, source) => {
  const headers = [
    "Employee Email",
    "Employee Name",
    "Work Date",
    "Hours",
    "Earning Type",
    "Job",
    "Department",
    "Notes",
  ];

  const rows = records.map((record) => {
    const staff = getStaff(record);
    const isActual = source === "actual";
    const start = isActual ? record.clockInAt : record.startTime;
    const minutes = isActual ? getActualMinutes(record) : getScheduledMinutes(record);

    return {
      "Employee Email": staff.email || "",
      "Employee Name": staff.name || "",
      "Work Date": formatIsoDate(start),
      Hours: minutesToHours(minutes),
      "Earning Type": "Regular Hours",
      Job: getRole(record),
      Department: getUnitArea(record),
      Notes: isActual ? record.notes || record.attendanceOutcome || "" : record.notes || "Scheduled hours",
    };
  });

  return rowsToCsv(headers, rows);
};

const formatQuickBooksRows = (records, source) => {
  const headers = [
    "Employee",
    "Employee Email",
    "Date",
    "Start Time",
    "End Time",
    "Hours",
    "Service Item",
    "Class",
    "Billable",
    "Notes",
  ];

  const rows = records.map((record) => {
    const staff = getStaff(record);
    const isActual = source === "actual";
    const start = isActual ? record.clockInAt : record.startTime;
    const end = isActual ? record.clockOutAt : record.endTime;
    const minutes = isActual ? getActualMinutes(record) : getScheduledMinutes(record);

    return {
      Employee: staff.name || "",
      "Employee Email": staff.email || "",
      Date: formatIsoDate(start),
      "Start Time": formatIsoTime(start),
      "End Time": formatIsoTime(end),
      Hours: minutesToHours(minutes),
      "Service Item": getRole(record),
      Class: getUnitArea(record),
      Billable: "No",
      Notes: isActual ? record.notes || record.attendanceOutcome || "" : record.notes || "Scheduled hours",
    };
  });

  return rowsToCsv(headers, rows);
};

const formatRipplingRows = (records, source) => {
  const headers = [
    "Employee ID",
    "Employee Email",
    "Employee Name",
    "Date",
    "Start Time",
    "End Time",
    "Hours",
    "Pay Code",
    "Department",
    "Location",
    "Notes",
  ];

  const rows = records.map((record) => {
    const staff = getStaff(record);
    const isActual = source === "actual";
    const start = isActual ? record.clockInAt : record.startTime;
    const end = isActual ? record.clockOutAt : record.endTime;
    const minutes = isActual ? getActualMinutes(record) : getScheduledMinutes(record);

    return {
      "Employee ID": "",
      "Employee Email": staff.email || "",
      "Employee Name": staff.name || "",
      Date: formatIsoDate(start),
      "Start Time": formatIsoTime(start),
      "End Time": formatIsoTime(end),
      Hours: minutesToHours(minutes),
      "Pay Code": "Regular",
      Department: getRole(record),
      Location: getUnitArea(record),
      Notes: isActual ? record.notes || record.attendanceOutcome || "" : record.notes || "Scheduled hours",
    };
  });

  return rowsToCsv(headers, rows);
};

const formatProviderCsv = ({ provider, records, source }) => {
  switch (provider) {
    case "gusto":
      return formatGustoRows(records, source);
    case "quickbooks":
      return formatQuickBooksRows(records, source);
    case "rippling":
      return formatRipplingRows(records, source);
    default:
      return null;
  }
};

module.exports = {
  normalizeProvider,
  formatProviderCsv,
};