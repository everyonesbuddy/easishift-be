/**
 * Staff (contacts)
 * ----------------
 * The people being scheduled. They never log in: the scheduler adds them
 * with a name plus a phone and/or email, and they get a personal link.
 *
 * Routes: /api/v1/staff
 */
const mongoose = require("mongoose");
const { parse } = require("csv-parse/sync");
const User = require("../models/userModel");
const Schedule = require("../models/scheduleModel");
const ShiftSwap = require("../models/shiftSwapModel");
const TimeOff = require("../models/timeOffModel");
const TimeEntry = require("../models/timeEntryModel");
const FacilityPreferences = require("../models/facilityPreferencesModel");
const { RESERVED_ROLES } = require("../config/authorization");
const { buildE164Number } = require("../utils/phone");
const { assertLimit } = require("../utils/planLimits");

const MAX_BULK_ROWS = 500;
const EDITABLE_FIELDS = [
  "name",
  "email",
  "userPhone",
  "userPhoneCountryCode",
  "roles",
  "allowedShiftTypes",
  "allowedAreas",
  "certificationTags",
  "notes",
];

// "Med Tech" -> "med_tech" (matches how roleFamilies are stored)
const normalizeRoleKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

const toList = (value) =>
  (Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[|,]/)
      : []
  )
    .map((item) => String(item || "").trim())
    .filter(Boolean);

const normalizeEmail = (value) => {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  return email || null;
};

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const toStaffResponse = (user) => {
  const doc = user.toObject ? user.toObject() : user;
  return {
    _id: doc._id,
    name: doc.name,
    roles: doc.roles || [],
    email: doc.email || null,
    userPhone: doc.userPhone || null,
    userPhoneCountryCode: doc.userPhoneCountryCode || null,
    phoneE164: doc.phoneE164 || null,
    hasPhone: Boolean(doc.phoneE164),
    hasEmail: Boolean(doc.email),
    smsStatus: doc.smsConsent?.status || "none",
    status: doc.status || "active",
    allowedShiftTypes: doc.allowedShiftTypes || [],
    allowedAreas: doc.allowedAreas || [],
    certificationTags: doc.certificationTags || [],
    notes: doc.notes || "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};

const getFacilityRoleSet = async (tenantId) => {
  const prefs = await FacilityPreferences.findOne({ tenantId })
    .select("roleFamilies")
    .lean();
  return new Set((prefs?.roleFamilies || []).map(normalizeRoleKey));
};

/**
 * Validates and normalizes one staff payload.
 * Returns { value } or { error }.
 */
const normalizeStaffInput = (input, facilityRoles, { partial = false } = {}) => {
  const value = {};

  if (!partial || input.name !== undefined) {
    const name = String(input.name || "").trim();
    if (!name) return { error: "Name is required" };
    value.name = name;
  }

  if (!partial || input.email !== undefined) {
    const email = normalizeEmail(input.email);
    if (email && !isEmail(email)) return { error: `Invalid email '${email}'` };
    value.email = email;
  }

  const phone =
    input.userPhone !== undefined ? input.userPhone : input.phone;
  const countryCode =
    input.userPhoneCountryCode !== undefined
      ? input.userPhoneCountryCode
      : input.countryCode;
  if (!partial || phone !== undefined || countryCode !== undefined) {
    const rawPhone = phone ? String(phone).trim() : null;
    if (rawPhone && !buildE164Number(countryCode, rawPhone)) {
      return { error: `Invalid phone number '${rawPhone}'` };
    }
    value.userPhone = rawPhone;
    value.userPhoneCountryCode = countryCode
      ? String(countryCode).trim()
      : null;
  }

  const rolesInput =
    input.roles !== undefined
      ? input.roles
      : input.role !== undefined
        ? [input.role]
        : undefined;
  if (!partial || rolesInput !== undefined) {
    const roles = Array.from(new Set(toList(rolesInput).map(normalizeRoleKey)));
    if (!roles.length) return { error: "Pick at least one role" };
    const reserved = roles.find((role) => RESERVED_ROLES.has(role));
    if (reserved) {
      return {
        error: `'${reserved}' is a workspace role. Add schedulers and viewers under Members.`,
      };
    }
    const unknown = roles.filter((role) => !facilityRoles.has(role));
    if (unknown.length) {
      return {
        error: `Unknown role${unknown.length > 1 ? "s" : ""} '${unknown.join(", ")}'. Add ${unknown.length > 1 ? "them" : "it"} to your facility roles first.`,
        allowedRoles: Array.from(facilityRoles),
      };
    }
    value.roles = roles;
    value.role = roles[0];
  }

  for (const key of ["allowedShiftTypes", "allowedAreas", "certificationTags"]) {
    if (!partial || input[key] !== undefined) {
      value[key] = Array.from(
        new Set(toList(input[key]).map((item) => item.toLowerCase())),
      );
    }
  }

  if (!partial || input.notes !== undefined) {
    value.notes = String(input.notes || "").trim();
  }

  return { value };
};

// Another contact in this workspace with the same email or phone.
const findDuplicate = ({ tenantId, email, phoneE164, excludeId }) => {
  const or = [];
  if (email) or.push({ email });
  if (phoneE164) or.push({ phoneE164 });
  if (!or.length) return null;
  return User.findOne({
    tenantId,
    loginEnabled: false,
    $or: or,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select("name status email phoneE164")
    .lean();
};

const duplicateResponse = (res, existing) =>
  res.status(409).json({
    message:
      existing.status === "archived"
        ? `${existing.name} is archived with this phone or email. Restore them instead.`
        : `${existing.name} already has this phone or email.`,
    errorCode: "DUPLICATE_STAFF",
    existingStaffId: existing._id,
    existingStatus: existing.status,
  });

const findStaff = (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return User.findOne({
    _id: req.params.id,
    tenantId: req.tenantId,
    loginEnabled: false,
  });
};

/**
 * GET /api/v1/staff?status=active|archived|all&q=
 */
exports.listStaff = async (req, res, next) => {
  try {
    const status = String(req.query.status || "active");
    const filter = { tenantId: req.tenantId, loginEnabled: false };
    if (status !== "all") filter.status = status;
    if (req.query.q) {
      const escaped = String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.name = { $regex: escaped, $options: "i" };
    }
    const staff = await User.find(filter).sort({ name: 1 }).lean();
    res.json(staff.map(toStaffResponse));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/staff/:id
 */
exports.getStaff = async (req, res, next) => {
  try {
    const staff = await findStaff(req);
    if (!staff) return res.status(404).json({ message: "Staff not found" });
    res.json(toStaffResponse(staff));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/staff
 * Body: { name, phone|userPhone, countryCode|userPhoneCountryCode, email,
 *         roles[] | role, allowedShiftTypes[], allowedAreas[],
 *         certificationTags[], notes }
 * Sends nothing — staff hear from us when a schedule is published.
 */
exports.createStaff = async (req, res, next) => {
  try {
    const facilityRoles = await getFacilityRoleSet(req.tenantId);
    const { value, error, allowedRoles } = normalizeStaffInput(
      req.body || {},
      facilityRoles,
    );
    if (error) return res.status(400).json({ message: error, allowedRoles });

    const phoneE164 = buildE164Number(
      value.userPhoneCountryCode,
      value.userPhone,
    );
    if (!value.email && !phoneE164) {
      return res
        .status(400)
        .json({ message: "Add a phone number or an email address" });
    }

    const existing = await findDuplicate({
      tenantId: req.tenantId,
      email: value.email,
      phoneE164,
    });
    if (existing) return duplicateResponse(res, existing);

    await assertLimit(req, "staff");

    const staff = await User.create({
      ...value,
      tenantId: req.tenantId,
      loginEnabled: false,
      status: "active",
    });

    res.status(201).json(toStaffResponse(staff));
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(409).json({
        message: "Someone in your staff list already has this phone or email.",
        errorCode: "DUPLICATE_STAFF",
      });
    }
    next(err);
  }
};

/**
 * Shared by bulk paste and CSV import.
 * rows: [{ name, phone, countryCode, email, role|roles }]
 */
const importRows = async (req, rows) => {
  const facilityRoles = await getFacilityRoleSet(req.tenantId);
  const results = [];
  const toCreate = [];
  const seenEmails = new Set();
  const seenPhones = new Set();

  for (const [index, row] of rows.entries()) {
    const rowNumber = row.rowNumber || index + 1;
    const { value, error } = normalizeStaffInput(row || {}, facilityRoles);
    if (error) {
      results.push({ rowNumber, name: row?.name || null, status: "failed_validation", reason: error });
      continue;
    }
    const phoneE164 = buildE164Number(value.userPhoneCountryCode, value.userPhone);
    if (!value.email && !phoneE164) {
      results.push({ rowNumber, name: value.name, status: "failed_validation", reason: "Add a phone number or an email address" });
      continue;
    }
    if ((value.email && seenEmails.has(value.email)) || (phoneE164 && seenPhones.has(phoneE164))) {
      results.push({ rowNumber, name: value.name, status: "skipped_duplicate", reason: "Same phone or email appears earlier in this list" });
      continue;
    }
    const existing = await findDuplicate({ tenantId: req.tenantId, email: value.email, phoneE164 });
    if (existing) {
      results.push({ rowNumber, name: value.name, status: "skipped_duplicate", reason: `${existing.name} already has this phone or email`, existingStaffId: existing._id });
      continue;
    }
    if (value.email) seenEmails.add(value.email);
    if (phoneE164) seenPhones.add(phoneE164);
    toCreate.push({ rowNumber, value });
  }

  // Check the plan once for everyone we're about to add.
  if (toCreate.length) await assertLimit(req, "staff", toCreate.length);

  let created = 0;
  for (const { rowNumber, value } of toCreate) {
    try {
      const staff = await User.create({
        ...value,
        tenantId: req.tenantId,
        loginEnabled: false,
        status: "active",
      });
      created += 1;
      results.push({ rowNumber, name: value.name, status: "created", staffId: staff._id });
    } catch (err) {
      results.push({
        rowNumber,
        name: value.name,
        status: err && err.code === 11000 ? "skipped_duplicate" : "failed",
        reason: err && err.code === 11000 ? "Phone or email already exists" : err.message,
      });
    }
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber);
  return {
    total: rows.length,
    created,
    skipped: results.filter((r) => r.status === "skipped_duplicate").length,
    failed: results.filter((r) => r.status.startsWith("failed")).length,
    rows: results,
  };
};

/**
 * POST /api/v1/staff/bulk
 * Body: { rows: [{ name, phone, countryCode, email, role }] }
 * (The "paste your list" step of onboarding.)
 */
exports.bulkCreateStaff = async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length)
      return res.status(400).json({ message: "rows must be a non-empty array" });
    if (rows.length > MAX_BULK_ROWS)
      return res
        .status(400)
        .json({ message: `Maximum ${MAX_BULK_ROWS} rows per request` });

    res.status(200).json(await importRows(req, rows));
  } catch (err) {
    next(err);
  }
};

// Accept the column names people actually use.
const CSV_COLUMN_ALIASES = {
  name: ["name", "full name", "staff", "employee", "employee name"],
  phone: ["phone", "mobile", "cell", "phone number", "mobile number", "userphone"],
  countryCode: ["country code", "countrycode", "userphonecountrycode"],
  email: ["email", "email address", "e-mail"],
  role: ["role", "roles", "position", "job", "title"],
};

const mapCsvRecord = (record) => {
  const lowered = Object.fromEntries(
    Object.entries(record).map(([key, val]) => [String(key).trim().toLowerCase(), val]),
  );
  const row = {};
  for (const [field, aliases] of Object.entries(CSV_COLUMN_ALIASES)) {
    const key = aliases.find((alias) => lowered[alias] !== undefined && lowered[alias] !== "");
    if (key) row[field] = lowered[key];
  }
  return row;
};

/**
 * POST /api/v1/staff/import  (multipart "file", or JSON { csv })
 * Pro feature.
 */
exports.importStaffCsv = async (req, res, next) => {
  try {
    const csvText = req.file?.buffer
      ? req.file.buffer.toString("utf8")
      : typeof req.body?.csv === "string"
        ? req.body.csv
        : "";
    if (!csvText.trim())
      return res.status(400).json({ message: "Upload a CSV file" });

    let records;
    try {
      records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
      return res.status(400).json({ message: `Could not read the CSV: ${err.message}` });
    }
    if (records.length > MAX_BULK_ROWS)
      return res
        .status(400)
        .json({ message: `Maximum ${MAX_BULK_ROWS} rows per file` });

    const rows = records.map((record, index) => ({
      rowNumber: index + 2, // +1 header, +1 one-based
      ...mapCsvRecord(record),
    }));
    res.status(200).json(await importRows(req, rows));
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/v1/staff/:id
 */
exports.updateStaff = async (req, res, next) => {
  try {
    const staff = await findStaff(req);
    if (!staff) return res.status(404).json({ message: "Staff not found" });

    const input = {};
    for (const key of [...EDITABLE_FIELDS, "phone", "countryCode", "role"]) {
      if (req.body?.[key] !== undefined) input[key] = req.body[key];
    }
    const facilityRoles = await getFacilityRoleSet(req.tenantId);
    const { value, error, allowedRoles } = normalizeStaffInput(
      input,
      facilityRoles,
      { partial: true },
    );
    if (error) return res.status(400).json({ message: error, allowedRoles });

    const phoneChanged =
      value.userPhone !== undefined &&
      buildE164Number(value.userPhoneCountryCode, value.userPhone) !==
        staff.phoneE164;

    Object.assign(staff, value);
    if (phoneChanged) {
      // A new number has to opt in again.
      staff.smsConsent = { status: "none", updatedAt: new Date() };
    }

    const nextPhone = buildE164Number(staff.userPhoneCountryCode, staff.userPhone);
    const existing = await findDuplicate({
      tenantId: req.tenantId,
      email: staff.email,
      phoneE164: nextPhone,
      excludeId: staff._id,
    });
    if (existing) return duplicateResponse(res, existing);

    await staff.save();
    res.json(toStaffResponse(staff));
  } catch (err) {
    if (err && err.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    next(err);
  }
};

/**
 * POST /api/v1/staff/:id/archive
 * Keeps history; removes them from future shifts and pending swaps.
 */
exports.archiveStaff = async (req, res, next) => {
  try {
    const staff = await findStaff(req);
    if (!staff) return res.status(404).json({ message: "Staff not found" });
    if (staff.status === "archived") return res.json(toStaffResponse(staff));

    const now = new Date();
    const [removedShifts, cancelledSwaps] = await Promise.all([
      Schedule.deleteMany({
        tenantId: req.tenantId,
        staffId: staff._id,
        startTime: { $gt: now },
        status: "scheduled",
      }),
      ShiftSwap.updateMany(
        {
          tenantId: req.tenantId,
          status: { $in: ["pending_admin", "pending_receiver"] },
          $or: [{ requesterStaffId: staff._id }, { receiverStaffId: staff._id }],
        },
        { $set: { status: "cancelled", respondedAt: now } },
      ),
    ]);

    staff.status = "archived";
    await staff.save({ validateBeforeSave: false });

    res.json({
      ...toStaffResponse(staff),
      removedFutureShifts: removedShifts.deletedCount || 0,
      cancelledSwaps: cancelledSwaps.modifiedCount || 0,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/staff/:id/restore
 */
exports.restoreStaff = async (req, res, next) => {
  try {
    const staff = await findStaff(req);
    if (!staff) return res.status(404).json({ message: "Staff not found" });
    if (staff.status === "active") return res.json(toStaffResponse(staff));

    const existing = await findDuplicate({
      tenantId: req.tenantId,
      email: staff.email,
      phoneE164: staff.phoneE164,
      excludeId: staff._id,
    });
    if (existing && existing.status === "active")
      return duplicateResponse(res, existing);

    await assertLimit(req, "staff");
    staff.status = "active";
    await staff.save({ validateBeforeSave: false });
    res.json(toStaffResponse(staff));
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/staff/:id
 * Only for people with no history (added by mistake). Otherwise archive.
 */
exports.deleteStaff = async (req, res, next) => {
  try {
    const staff = await findStaff(req);
    if (!staff) return res.status(404).json({ message: "Staff not found" });

    const [shifts, entries, timeOff] = await Promise.all([
      Schedule.countDocuments({ tenantId: req.tenantId, staffId: staff._id }),
      TimeEntry.countDocuments({ tenantId: req.tenantId, staffId: staff._id }),
      TimeOff.countDocuments({ tenantId: req.tenantId, staffId: staff._id }),
    ]);
    if (shifts || entries || timeOff) {
      return res.status(409).json({
        message: `${staff.name} has shift history. Archive them instead so the history stays.`,
        errorCode: "HAS_HISTORY",
      });
    }

    await User.deleteOne({ _id: staff._id, tenantId: req.tenantId });
    res.json({ message: "Staff deleted" });
  } catch (err) {
    next(err);
  }
};

// Exposed for unit tests.
exports._normalizeStaffInput = normalizeStaffInput;
exports._mapCsvRecord = mapCsvRecord;
exports._normalizeRoleKey = normalizeRoleKey;
