const escapeCsvValue = (value) => {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

const rowsToCsv = (headers, rows) => {
  const headerLine = headers.map(escapeCsvValue).join(",");
  const rowLines = rows.map((row) =>
    headers.map((header) => escapeCsvValue(row[header])).join(","),
  );

  return [headerLine, ...rowLines].join("\r\n");
};

const formatIsoDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};

const formatIsoTime = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(11, 16);
};

const minutesBetween = (start, end) => {
  if (!start || !end) return 0;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 0;
  }
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));
};

const minutesToHours = (minutes) =>
  (Math.max(0, Number(minutes) || 0) / 60).toFixed(2);

module.exports = {
  rowsToCsv,
  formatIsoDate,
  formatIsoTime,
  minutesBetween,
  minutesToHours,
};