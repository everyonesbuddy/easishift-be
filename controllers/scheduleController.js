// controllers/scheduleController.js
const Schedule = require("../models/scheduleModel");
const Coverage = require("../models/coverageModel");
const Preferences = require("../models/preferencesModel");
const TimeOff = require("../models/timeOffModel");
const User = require("../models/userModel");
const ShiftSwap = require("../models/shiftSwapModel");
const { hasConflict } = require("../utils/scheduleUtils");
const { sendEmail } = require("../utils/sendEmail");
const { sendSMS } = require("../utils/sendSMS");

const MINUTES_IN_WEEK = 40 * 60;
const FAIRNESS_LOOKBACK_DAYS = 28;

const minutesBetween = (start, end) =>
  (new Date(end) - new Date(start)) / 60000;

const getUtcWeekStart = (dateLike) => {
  const date = new Date(dateLike);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date;
};

const buildWeekKey = (staffId, dateLike) =>
  `${staffId.toString()}|${getUtcWeekStart(dateLike).toISOString()}`;

const stableHash = (value) => {
  const text = String(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const buildRankingMetrics = ({
  staffId,
  coverageStart,
  coverageMinutes,
  coverageId,
  weeklyWorkload,
  recentWorkload,
}) => {
  const weekKey = buildWeekKey(staffId, coverageStart);
  const projectedWeekMinutes = (weeklyWorkload[weekKey] || 0) + coverageMinutes;
  const overtimeMinutes = Math.max(0, projectedWeekMinutes - MINUTES_IN_WEEK);
  const recentMinutes = recentWorkload[staffId] || 0;
  const tieBreaker = stableHash(`${coverageId.toString()}|${staffId}`);

  return {
    weekKey,
    projectedWeekMinutes,
    overtimeMinutes,
    recentMinutes,
    tieBreaker,
  };
};

const compareRankingMetrics = (a, b) => {
  if (a.overtimeMinutes !== b.overtimeMinutes) {
    return a.overtimeMinutes - b.overtimeMinutes;
  }

  if (a.projectedWeekMinutes !== b.projectedWeekMinutes) {
    return a.projectedWeekMinutes - b.projectedWeekMinutes;
  }

  if (a.recentMinutes !== b.recentMinutes) {
    return a.recentMinutes - b.recentMinutes;
  }

  return a.tieBreaker - b.tieBreaker;
};

const getNotSelectedReason = (candidateMetrics, cutoffMetrics) => {
  if (!cutoffMetrics) return "no cutoff available";

  if (candidateMetrics.overtimeMinutes > cutoffMetrics.overtimeMinutes) {
    return `higher projected overtime (${candidateMetrics.overtimeMinutes}m > ${cutoffMetrics.overtimeMinutes}m)`;
  }

  if (
    candidateMetrics.projectedWeekMinutes > cutoffMetrics.projectedWeekMinutes
  ) {
    return `higher projected weekly load (${candidateMetrics.projectedWeekMinutes}m > ${cutoffMetrics.projectedWeekMinutes}m)`;
  }

  if (candidateMetrics.recentMinutes > cutoffMetrics.recentMinutes) {
    return `higher recent workload (${candidateMetrics.recentMinutes}m > ${cutoffMetrics.recentMinutes}m)`;
  }

  if (candidateMetrics.tieBreaker > cutoffMetrics.tieBreaker) {
    return "tie-breaker rank lower";
  }

  return "lower overall ranking score";
};

const buildE164Number = (countryCode, phone) => {
  if (!phone) return null;

  const rawPhone = String(phone).trim();
  if (!rawPhone) return null;
  if (rawPhone.startsWith("+")) return rawPhone;

  if (!countryCode) return null;
  const normalizedCountryCode = String(countryCode).trim();
  if (!normalizedCountryCode) return null;

  const prefix = normalizedCountryCode.startsWith("+")
    ? normalizedCountryCode
    : `+${normalizedCountryCode}`;

  return `${prefix}${rawPhone}`;
};

const isScheduleEmailNotificationEnabled = (preferences) =>
  preferences?.scheduleEmailNotificationsEnabled !== false;

const isScheduleSmsNotificationEnabled = (preferences) =>
  preferences?.scheduleSmsNotificationsEnabled !== false;

const formatCoverageForMessage = (coverage) => ({
  coverageId: coverage._id,
  role: coverage.role,
  date: new Date(coverage.date).toISOString(),
  startTime: new Date(coverage.startTime).toISOString(),
  endTime: new Date(coverage.endTime).toISOString(),
  requiredCount: coverage.requiredCount,
});

const toUtcString = (value) => new Date(value).toUTCString();

const notifyUsersBestEffort = async ({
  tenantId,
  users,
  emailSubject,
  emailHtml,
  smsBody,
}) => {
  const uniqueUsers = [];
  const seen = new Set();

  for (const user of users || []) {
    if (!user || !user._id) continue;
    const key = user._id.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueUsers.push(user);
  }

  if (!uniqueUsers.length) return;

  const preferenceDocs = await Preferences.find({
    tenantId,
    staffId: { $in: uniqueUsers.map((user) => user._id) },
  }).select(
    "staffId scheduleEmailNotificationsEnabled scheduleSmsNotificationsEnabled",
  );

  const preferenceMap = {};
  preferenceDocs.forEach((pref) => {
    preferenceMap[pref.staffId.toString()] = pref;
  });

  for (const user of uniqueUsers) {
    const pref = preferenceMap[user._id.toString()];

    try {
      if (user.email && isScheduleEmailNotificationEnabled(pref)) {
        await sendEmail(user.email, emailSubject, emailHtml(user));
      }

      const to = isScheduleSmsNotificationEnabled(pref)
        ? buildE164Number(user.userPhoneCountryCode, user.userPhone)
        : null;

      if (to) {
        await sendSMS(to, smsBody(user));
      }
    } catch (err) {
      console.error(
        `Failed swap notification for user ${user._id}:`,
        err && err.message ? err.message : err,
      );
    }
  }
};

const getTenantAdmins = async (tenantId, excludeUserIds = []) => {
  const excluded = excludeUserIds.map((id) => id.toString());
  return User.find({
    tenantId,
    role: "admin",
    _id: { $nin: excluded },
  });
};

// AUTO-GENERATE SCHEDULE FOR SELECTED COVERAGES
exports.autoGenerateSchedule = async (req, res, next) => {
  try {
    const { coverageIds } = req.body;

    if (!coverageIds || !Array.isArray(coverageIds) || !coverageIds.length) {
      console.log("No coverageIds provided");
      return res.status(400).json({
        status: "error",
        errorCode: "COVERAGE_IDS_REQUIRED",
        message: "coverageIds are required",
        hint: "Select at least one coverage and try AI-generate again.",
      });
    }

    const tenantId = req.tenantId;

    // 1) GET COVERAGE DETAILS
    const coverageList = await Coverage.find({
      tenantId,
      _id: { $in: coverageIds },
    }).sort({ date: 1, startTime: 1 });

    if (!coverageList.length) {
      console.log("No valid coverage found");
      return res.status(404).json({
        status: "error",
        errorCode: "NO_VALID_COVERAGE_FOUND",
        message: "No valid coverage found for the selected coverageIds",
        hint: "Refresh coverage data and reselect open coverage items.",
      });
    }

    console.log(`Found ${coverageList.length} coverage(s) to process`);

    // 2) LOAD TIME OFF
    const end = new Date(Math.max(...coverageList.map((c) => c.endTime)));
    const start = new Date(Math.min(...coverageList.map((c) => c.startTime)));
    const fairnessWindowStart = new Date(start);
    fairnessWindowStart.setUTCDate(
      fairnessWindowStart.getUTCDate() - FAIRNESS_LOOKBACK_DAYS,
    );
    const firstCoverageWeekStart = getUtcWeekStart(start);
    const lastCoverageWeekStart = getUtcWeekStart(end);
    const weeklyWindowEnd = new Date(lastCoverageWeekStart);
    weeklyWindowEnd.setUTCDate(weeklyWindowEnd.getUTCDate() + 7);

    const timeOff = await TimeOff.find({
      tenantId,
      status: "approved",
      $or: [
        { start: { $lte: end }, end: { $gte: start } },
        { startDate: { $lte: end }, endDate: { $gte: start } },
      ],
    });

    const timeOffMap = {};
    timeOff.forEach((t) => {
      const id = t.staffId.toString();
      if (!timeOffMap[id]) timeOffMap[id] = [];
      timeOffMap[id].push(t);
    });

    console.log(`Loaded time-off records for ${timeOff.length} staff`);

    // 3) LOAD EXISTING SCHEDULES (ignore completed + legacy cancelled; keep call_out for availability checks)
    const existingSchedules = await Schedule.find({
      tenantId,
      status: { $nin: ["completed", "cancelled"] },
      startTime: { $gte: start, $lte: end },
    });

    const existingByStaff = {};
    existingSchedules.forEach((s) => {
      const id = s.staffId.toString();
      if (!existingByStaff[id]) existingByStaff[id] = [];
      existingByStaff[id].push(s);
    });

    const fairnessSchedules = await Schedule.find({
      tenantId,
      status: { $in: ["scheduled", "completed"] },
      startTime: { $lte: end },
      endTime: { $gte: fairnessWindowStart },
    }).select("staffId startTime endTime");

    const recentWorkload = {};
    const weeklyWorkload = {};

    fairnessSchedules.forEach((schedule) => {
      const staffId = schedule.staffId.toString();
      const minutes = minutesBetween(schedule.startTime, schedule.endTime);

      recentWorkload[staffId] = (recentWorkload[staffId] || 0) + minutes;

      const scheduleWeekStart = getUtcWeekStart(schedule.startTime);
      if (
        scheduleWeekStart >= firstCoverageWeekStart &&
        scheduleWeekStart < weeklyWindowEnd
      ) {
        const key = buildWeekKey(staffId, schedule.startTime);
        weeklyWorkload[key] = (weeklyWorkload[key] || 0) + minutes;
      }
    });

    console.log(
      `Loaded existing schedules for ${existingSchedules.length} shifts`,
    );

    const generated = [];
    const coverageResults = [];
    const notifications = {
      email: { sent: 0, failed: 0 },
      sms: { sent: 0, failed: 0 },
    };

    // 4) LOOP THROUGH COVERAGES
    for (const cov of coverageList) {
      console.log(
        `\nProcessing coverage: ${cov._id}, role: ${cov.role}, start: ${cov.startTime}, end: ${cov.endTime}`,
      );

      const coverageMeta = formatCoverageForMessage(cov);

      const weekday = cov.date.getUTCDay();

      const roleStaff = await User.find({ tenantId, role: cov.role });
      if (!roleStaff.length) {
        console.log(`No staff found for role ${cov.role}`);
        coverageResults.push({
          ...coverageMeta,
          status: "skipped",
          reasonCode: "NO_STAFF_FOR_ROLE",
          message: `No staff found with role ${cov.role}.`,
          assignedCount: 0,
        });
        continue;
      }

      const staffIds = roleStaff.map((u) => u._id.toString());

      const prefs = await Preferences.find({
        tenantId,
        staffId: { $in: staffIds },
      });

      const prefMap = {};
      prefs.forEach((p) => (prefMap[p.staffId.toString()] = p));

      // FILTER AVAILABLE STAFF
      let available = [];
      const skippedByReason = {};
      for (const staff of roleStaff) {
        const id = staff._id.toString();
        const pref = prefMap[id];
        let skipReason = null;

        if (pref?.unavailableDaysOfWeek?.includes(weekday)) {
          skipReason = `unavailable on weekday ${weekday}`;
        } else if (
          existingByStaff[id]?.some(
            (s) =>
              s.status === "call_out" &&
              s.role === cov.role &&
              s.startTime.getTime() === cov.startTime.getTime() &&
              s.endTime.getTime() === cov.endTime.getTime(),
          )
        ) {
          skipReason = `called out for this shift`;
        } else if (
          timeOffMap[id]?.some(
            (to) =>
              new Date(to.start) <= cov.endTime &&
              new Date(to.end) >= cov.startTime,
          )
        ) {
          skipReason = `has approved time off overlapping coverage`;
        } else if (
          existingByStaff[id]?.some(
            (s) => !(s.endTime <= cov.startTime || s.startTime >= cov.endTime),
          )
        ) {
          skipReason = `already scheduled for overlapping shift`;
        } else if (
          existingByStaff[id]?.some(
            (s) => Math.abs(s.endTime - cov.startTime) < 30 * 60 * 1000,
          )
        ) {
          skipReason = `less than 30 min break from previous shift`;
        }

        if (skipReason) {
          skippedByReason[skipReason] = (skippedByReason[skipReason] || 0) + 1;
          console.log(`Skipping staff ${staff.name} (${id}): ${skipReason}`);
        } else {
          available.push(staff);
          console.log(`Staff ${staff.name} (${id}) is available`);
        }
      }

      if (!available.length) {
        console.log("No available staff for this coverage");
        coverageResults.push({
          ...coverageMeta,
          status: "skipped",
          reasonCode: "NO_AVAILABLE_STAFF",
          message:
            "No eligible staff available due to conflicts, time off, call out, availability preferences, or break constraints.",
          assignedCount: 0,
          skippedByReason,
        });
        continue;
      }

      const alreadyAssigned = existingSchedules.filter(
        (s) =>
          s.status !== "call_out" &&
          s.role === cov.role &&
          s.startTime.getTime() === cov.startTime.getTime() &&
          s.endTime.getTime() === cov.endTime.getTime(),
      );

      const needed = cov.requiredCount - alreadyAssigned.length;
      console.log(`${needed} staff needed for this coverage`);

      if (needed <= 0) {
        console.log("Coverage already fully assigned");
        coverageResults.push({
          ...coverageMeta,
          status: "already_filled",
          reasonCode: "ALREADY_FULLY_ASSIGNED",
          message: "Coverage is already fully assigned.",
          assignedCount: 0,
          alreadyAssignedCount: alreadyAssigned.length,
        });
        continue;
      }

      const coverageMinutes = minutesBetween(cov.startTime, cov.endTime);
      const rankedCandidates = available
        .map((staff) => {
          const staffId = staff._id.toString();
          return {
            staff,
            metrics: buildRankingMetrics({
              staffId,
              coverageStart: cov.startTime,
              coverageMinutes,
              coverageId: cov._id,
              weeklyWorkload,
              recentWorkload,
            }),
          };
        })
        .sort((a, b) => compareRankingMetrics(a.metrics, b.metrics));

      console.log(
        `[Ranking] Coverage ${cov._id}: ranked ${rankedCandidates.length} eligible staff (need ${needed}).`,
      );
      rankedCandidates.forEach((entry, rankIndex) => {
        const { staff, metrics } = entry;
        console.log(
          `[Ranking] #${rankIndex + 1} ${staff.name || "Unknown"} (${staff._id}) -> overtime=${metrics.overtimeMinutes}m, projectedWeek=${metrics.projectedWeekMinutes}m, recent28d=${metrics.recentMinutes}m, tie=${metrics.tieBreaker}`,
        );
      });

      const selectedRanked = rankedCandidates.slice(0, needed);
      const selected = selectedRanked.map((entry) => entry.staff);
      const cutoffMetrics =
        selectedRanked.length > 0
          ? selectedRanked[selectedRanked.length - 1].metrics
          : null;

      rankedCandidates.slice(needed).forEach((entry) => {
        const reason = getNotSelectedReason(entry.metrics, cutoffMetrics);
        console.log(
          `[Not Selected] ${entry.staff.name || "Unknown"} (${entry.staff._id}) for coverage ${cov._id}: ${reason}`,
        );
      });

      const assignmentDetails = [];

      for (const staff of selected) {
        const staffPref = prefMap[staff._id.toString()];

        const newShift = await Schedule.create({
          tenantId,
          staffId: staff._id,
          role: cov.role,
          startTime: cov.startTime,
          endTime: cov.endTime,
          timezone: "UTC",
          notes: "Auto-generated",
          status: "scheduled",
          meta: { autoGenerated: true, createdBy: req.user._id },
        });

        console.log(
          `Assigned staff ${staff.name} (${staff._id}) to coverage ${cov._id}`,
        );

        generated.push(newShift);
        assignmentDetails.push({
          scheduleId: newShift._id,
          staffId: staff._id,
          staffName: staff.name,
        });

        const staffId = staff._id.toString();
        recentWorkload[staffId] =
          (recentWorkload[staffId] || 0) + coverageMinutes;
        const weekKey = buildWeekKey(staffId, cov.startTime);
        weeklyWorkload[weekKey] =
          (weeklyWorkload[weekKey] || 0) + coverageMinutes;

        existingSchedules.push(newShift);
        if (!existingByStaff[staff._id]) existingByStaff[staff._id] = [];
        existingByStaff[staff._id].push(newShift);

        // Notify staff by email about the new assignment (best-effort)
        try {
          if (staff.email && isScheduleEmailNotificationEnabled(staffPref)) {
            const subject = `New shift assigned: ${cov.role} - ${cov.startTime.toUTCString()}`;
            const html = `
              <p>Hi ${staff.name || "team member"},</p>
              <p>You have been assigned a new shift:</p>
              <ul>
                <li><strong>Role:</strong> ${cov.role}</li>
                <li><strong>Start (UTC):</strong> ${cov.startTime.toUTCString()}</li>
                <li><strong>End (UTC):</strong> ${cov.endTime.toUTCString()}</li>
                <li><strong>Notes:</strong> Auto-generated</li>
              </ul>
              <p>Please contact your admin if you have any questions.</p>
            `;

            const result = await sendEmail(staff.email, subject, html);
            if (result && result.success) {
              notifications.email.sent += 1;
              console.log(
                `Notification email sent to ${staff.email} for shift ${newShift._id}`,
              );
            } else {
              notifications.email.failed += 1;
              console.error(
                `Notification email failed for ${staff.email} (shift ${newShift._id}):`,
                result && result.error ? result.error : "unknown error",
              );
            }
          }

          const to = isScheduleSmsNotificationEnabled(staffPref)
            ? buildE164Number(staff.userPhoneCountryCode, staff.userPhone)
            : null;
          if (to) {
            const smsBody = `New shift assigned: ${cov.role}. Start (UTC): ${cov.startTime.toUTCString()}. End (UTC): ${cov.endTime.toUTCString()}.`;
            const smsResult = await sendSMS(to, smsBody);
            if (smsResult && smsResult.success) {
              notifications.sms.sent += 1;
              console.log(
                `Notification SMS sent to ${to} for shift ${newShift._id}`,
              );
            } else {
              notifications.sms.failed += 1;
              console.error(
                `Notification SMS failed for ${to} (shift ${newShift._id}):`,
                smsResult && smsResult.error
                  ? smsResult.error
                  : "unknown error",
              );
            }
          }
        } catch (err) {
          notifications.email.failed += staff.email ? 1 : 0;
          notifications.sms.failed += buildE164Number(
            staff.userPhoneCountryCode,
            staff.userPhone,
          )
            ? 1
            : 0;
          console.error(
            `Failed to send assignment notifications to ${staff._id}:`,
            err && err.message ? err.message : err,
          );
        }
      }

      const unfilledCount = Math.max(0, needed - selected.length);
      coverageResults.push({
        ...coverageMeta,
        status: unfilledCount > 0 ? "partially_filled" : "filled",
        message:
          unfilledCount > 0
            ? `Assigned ${selected.length} of ${needed} needed staff.`
            : `Assigned ${selected.length} staff successfully.`,
        assignedCount: selected.length,
        neededCount: needed,
        availableCount: available.length,
        alreadyAssignedCount: alreadyAssigned.length,
        unfilledCount,
        skippedByReason,
        assignments: assignmentDetails,
      });
    }

    console.log(
      `\nAuto-scheduling complete, ${generated.length} shift(s) generated`,
    );

    const summary = {
      requestedCoverageIds: coverageIds.length,
      processedCoverageCount: coverageList.length,
      generatedShiftCount: generated.length,
      filledCoverageCount: coverageResults.filter((r) => r.status === "filled")
        .length,
      partiallyFilledCoverageCount: coverageResults.filter(
        (r) => r.status === "partially_filled",
      ).length,
      skippedCoverageCount: coverageResults.filter(
        (r) => r.status === "skipped",
      ).length,
      alreadyFilledCoverageCount: coverageResults.filter(
        (r) => r.status === "already_filled",
      ).length,
      notifications,
    };

    const successMessage = generated.length
      ? `Auto-scheduling completed: ${generated.length} shift(s) generated across ${summary.filledCoverageCount + summary.partiallyFilledCoverageCount} coverage item(s).`
      : "Auto-scheduling completed with no new shifts generated.";

    const warningMessage = summary.skippedCoverageCount
      ? `${summary.skippedCoverageCount} coverage item(s) were skipped. Review coverageResults for details.`
      : null;

    res.json({
      status: "success",
      message: successMessage,
      warning: warningMessage,
      summary,
      coverageResults,
      generatedCount: generated.length,
      schedules: generated,
    });
  } catch (err) {
    console.error("Error in autoGenerateSchedule:", err);
    return res.status(500).json({
      status: "error",
      errorCode: "AUTO_SCHEDULE_FAILED",
      message:
        "Auto-scheduling failed. Please try again, and contact support if the issue persists.",
      details: err && err.message ? err.message : "Unknown error",
    });
  }
};

// REQUEST SHIFT SWAP (same role only)
exports.requestShiftSwap = async (req, res, next) => {
  try {
    const scheduleId = req.params.id;
    const { receiverStaffId, note } = req.body;

    if (!receiverStaffId) {
      return res.status(400).json({ message: "receiverStaffId is required" });
    }

    const schedule = await Schedule.findOne({
      _id: scheduleId,
      tenantId: req.tenantId,
    });

    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    if (schedule.status !== "scheduled") {
      return res.status(400).json({
        message: "Only scheduled shifts can be swapped",
      });
    }

    const requesterId = schedule.staffId.toString();
    const actorId = req.user._id.toString();

    if (req.user.role !== "admin" && actorId !== requesterId) {
      return res.status(403).json({
        message: "Only the assigned staff member (or admin) can request a swap",
      });
    }

    if (requesterId === String(receiverStaffId)) {
      return res.status(400).json({
        message: "receiverStaffId must be different from current staffId",
      });
    }

    const [requester, receiver] = await Promise.all([
      User.findOne({ _id: schedule.staffId, tenantId: req.tenantId }),
      User.findOne({ _id: receiverStaffId, tenantId: req.tenantId }),
    ]);

    if (!requester || !receiver) {
      return res
        .status(404)
        .json({ message: "Requester or receiver staff not found" });
    }

    if (receiver.role !== schedule.role) {
      return res.status(400).json({
        message: "Shift swap is allowed only between staff in the same role",
      });
    }

    const conflict = await hasConflict({
      tenantId: req.tenantId,
      staffId: receiver._id,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
    });

    if (conflict) {
      return res.status(409).json({
        message: "Receiver has a conflicting schedule in this time slot",
        conflict,
      });
    }

    const pendingExisting = await ShiftSwap.findOne({
      tenantId: req.tenantId,
      scheduleId: schedule._id,
      receiverStaffId: receiver._id,
      status: "pending",
    });

    if (pendingExisting) {
      return res.status(409).json({
        message: "A pending swap request already exists for this receiver",
      });
    }

    const swapRequest = await ShiftSwap.create({
      tenantId: req.tenantId,
      scheduleId: schedule._id,
      requesterStaffId: requester._id,
      receiverStaffId: receiver._id,
      role: schedule.role,
      shiftStartTime: schedule.startTime,
      shiftEndTime: schedule.endTime,
      requestNote: note || "",
      status: "pending",
    });

    const admins = await getTenantAdmins(req.tenantId, [
      requester._id,
      receiver._id,
    ]);
    const recipients = [receiver, requester, ...admins];
    const shiftWindow = `${toUtcString(schedule.startTime)} - ${toUtcString(schedule.endTime)}`;

    await notifyUsersBestEffort({
      tenantId: req.tenantId,
      users: recipients,
      emailSubject: "Shift swap request",
      emailHtml: (user) => `
        <p>Hi ${user.name || "team member"},</p>
        <p>${requester.name || "A staff member"} requested a shift swap.</p>
        <ul>
          <li><strong>Role:</strong> ${schedule.role}</li>
          <li><strong>Current staff:</strong> ${requester.name || requester.email || requester._id}</li>
          <li><strong>Requested receiver:</strong> ${receiver.name || receiver.email || receiver._id}</li>
          <li><strong>Shift (UTC):</strong> ${shiftWindow}</li>
          <li><strong>Status:</strong> pending</li>
        </ul>
        ${note ? `<p><strong>Note:</strong> ${note}</p>` : ""}
      `,
      smsBody: () =>
        `Shift swap requested: ${schedule.role}, ${shiftWindow}. Receiver must accept or deny.`,
    });

    const populated = await ShiftSwap.findById(swapRequest._id)
      .populate("requesterStaffId", "name email role")
      .populate("receiverStaffId", "name email role")
      .populate("scheduleId", "role startTime endTime status");

    res.status(201).json({
      message: "Shift swap request submitted",
      swapRequest: populated,
    });
  } catch (err) {
    next(err);
  }
};

// LIST SHIFT SWAP REQUESTS
exports.getShiftSwapRequests = async (req, res, next) => {
  try {
    const { status, view = "all" } = req.query;
    const filter = { tenantId: req.tenantId };

    if (status) {
      filter.status = status;
    }

    if (req.user.role !== "admin") {
      filter.$or = [
        { requesterStaffId: req.user._id },
        { receiverStaffId: req.user._id },
      ];

      if (view === "inbox") {
        delete filter.$or;
        filter.receiverStaffId = req.user._id;
      }

      if (view === "outbox") {
        delete filter.$or;
        filter.requesterStaffId = req.user._id;
      }
    }

    const requests = await ShiftSwap.find(filter)
      .populate("requesterStaffId", "name email role")
      .populate("receiverStaffId", "name email role")
      .populate("scheduleId", "role startTime endTime status staffId")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (err) {
    next(err);
  }
};

// ACCEPT OR DENY SHIFT SWAP REQUEST
exports.respondToShiftSwapRequest = async (req, res, next) => {
  try {
    const { decision, responseNote } = req.body;
    const normalizedDecision = String(decision || "").toLowerCase();

    if (!["accept", "deny"].includes(normalizedDecision)) {
      return res
        .status(400)
        .json({ message: "decision must be either 'accept' or 'deny'" });
    }

    const swapRequest = await ShiftSwap.findOne({
      _id: req.params.swapRequestId,
      tenantId: req.tenantId,
    });

    if (!swapRequest) {
      return res.status(404).json({ message: "Swap request not found" });
    }

    if (swapRequest.status !== "pending") {
      return res
        .status(400)
        .json({ message: `Swap request is already ${swapRequest.status}` });
    }

    const canRespond =
      req.user.role === "admin" ||
      swapRequest.receiverStaffId.toString() === req.user._id.toString();

    if (!canRespond) {
      return res.status(403).json({
        message: "Only the receiving staff member (or admin) can respond",
      });
    }

    const schedule = await Schedule.findOne({
      _id: swapRequest.scheduleId,
      tenantId: req.tenantId,
    });

    if (!schedule) {
      return res.status(404).json({ message: "Original schedule not found" });
    }

    const [requester, receiver] = await Promise.all([
      User.findOne({
        _id: swapRequest.requesterStaffId,
        tenantId: req.tenantId,
      }),
      User.findOne({
        _id: swapRequest.receiverStaffId,
        tenantId: req.tenantId,
      }),
    ]);

    if (!requester || !receiver) {
      return res
        .status(404)
        .json({ message: "Requester or receiver staff not found" });
    }

    if (normalizedDecision === "accept") {
      if (schedule.staffId.toString() !== requester._id.toString()) {
        return res.status(409).json({
          message:
            "This shift is no longer assigned to the original requester; swap cannot be completed",
        });
      }

      if (receiver.role !== schedule.role) {
        return res.status(400).json({
          message:
            "Swap cannot be accepted because receiver role no longer matches shift role",
        });
      }

      const conflict = await hasConflict({
        tenantId: req.tenantId,
        staffId: receiver._id,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
      });

      if (conflict) {
        return res.status(409).json({
          message: "Receiver now has a conflicting schedule in this time slot",
          conflict,
        });
      }

      schedule.staffId = receiver._id;
      const swapAudit = `Shift swapped from ${requester.name || requester._id} to ${receiver.name || receiver._id} on ${new Date().toUTCString()}`;
      schedule.notes = schedule.notes
        ? `${schedule.notes}\n${swapAudit}`
        : swapAudit;
      await schedule.save();

      swapRequest.status = "accepted";
    } else {
      swapRequest.status = "denied";
    }

    swapRequest.responseNote = responseNote || "";
    swapRequest.respondedAt = new Date();
    swapRequest.resolvedBy = req.user._id;
    await swapRequest.save();

    const admins = await getTenantAdmins(req.tenantId, [
      requester._id,
      receiver._id,
    ]);
    const recipients = [requester, receiver, ...admins];
    const shiftWindow = `${toUtcString(swapRequest.shiftStartTime)} - ${toUtcString(swapRequest.shiftEndTime)}`;
    const decisionWord =
      normalizedDecision === "accept" ? "accepted" : "denied";

    await notifyUsersBestEffort({
      tenantId: req.tenantId,
      users: recipients,
      emailSubject: `Shift swap ${decisionWord}`,
      emailHtml: (user) => `
        <p>Hi ${user.name || "team member"},</p>
        <p>The shift swap request has been <strong>${decisionWord}</strong>.</p>
        <ul>
          <li><strong>Role:</strong> ${swapRequest.role}</li>
          <li><strong>Requester:</strong> ${requester.name || requester.email || requester._id}</li>
          <li><strong>Receiver:</strong> ${receiver.name || receiver.email || receiver._id}</li>
          <li><strong>Shift (UTC):</strong> ${shiftWindow}</li>
          <li><strong>Decision:</strong> ${decisionWord}</li>
        </ul>
        ${responseNote ? `<p><strong>Response note:</strong> ${responseNote}</p>` : ""}
      `,
      smsBody: () =>
        `Shift swap ${decisionWord}: ${swapRequest.role}, ${shiftWindow}.`,
    });

    const populated = await ShiftSwap.findById(swapRequest._id)
      .populate("requesterStaffId", "name email role")
      .populate("receiverStaffId", "name email role")
      .populate("scheduleId", "role startTime endTime status staffId notes");

    res.json({
      message: `Shift swap ${decisionWord}`,
      swapRequest: populated,
      scheduleUpdated: normalizedDecision === "accept",
    });
  } catch (err) {
    next(err);
  }
};

// CREATE SCHEDULE
exports.createSchedule = async (req, res, next) => {
  try {
    const { staffId, role, startTime, endTime, notes, timezone } = req.body;

    if (!staffId || !role || !startTime || !endTime)
      return res.status(400).json({
        message: "staffId, role, startTime, endTime are required",
      });

    // Check conflict
    const conflict = await hasConflict({
      tenantId: req.tenantId,
      staffId,
      startTime,
      endTime,
    });
    if (conflict)
      return res.status(409).json({ message: "Schedule conflict", conflict });

    const schedule = await Schedule.create({
      tenantId: req.tenantId,
      staffId,
      role,
      startTime,
      endTime,
      notes,
      timezone: timezone || "UTC",
      status: "scheduled",
      meta: { createdBy: req.user._id },
    });

    // Notify assigned staff (best-effort)
    try {
      const staff = await User.findById(staffId);
      const staffPref = staff
        ? await Preferences.findOne({
            tenantId: req.tenantId,
            staffId: staff._id,
          })
        : null;

      if (
        staff &&
        staff.email &&
        isScheduleEmailNotificationEnabled(staffPref)
      ) {
        const subject = `New shift assigned: ${role} - ${new Date(startTime).toUTCString()}`;
        const html = `
          <p>Hi ${staff.name || "team member"},</p>
          <p>You have been assigned a new shift:</p>
          <ul>
            <li><strong>Role:</strong> ${role}</li>
            <li><strong>Start (UTC):</strong> ${new Date(startTime).toUTCString()}</li>
            <li><strong>End (UTC):</strong> ${new Date(endTime).toUTCString()}</li>
            <li><strong>Notes:</strong> ${notes || ""}</li>
          </ul>
          <p>Please contact your admin if you have any questions.</p>
        `;

        const result = await sendEmail(staff.email, subject, html);
        if (result && result.success) {
          console.log(
            `Notification email sent to ${staff.email} for schedule ${schedule._id}`,
          );
        } else {
          console.error(
            `Notification email failed for ${staff.email} (schedule ${schedule._id}):`,
            result && result.error ? result.error : "unknown error",
          );
        }
      }

      const to =
        staff && isScheduleSmsNotificationEnabled(staffPref)
          ? buildE164Number(staff.userPhoneCountryCode, staff.userPhone)
          : null;
      if (to) {
        const smsBody = `New shift assigned: ${role}. Start (UTC): ${new Date(startTime).toUTCString()}. End (UTC): ${new Date(endTime).toUTCString()}.`;
        const smsResult = await sendSMS(to, smsBody);
        if (smsResult && smsResult.success) {
          console.log(
            `Notification SMS sent to ${to} for schedule ${schedule._id}`,
          );
        } else {
          console.error(
            `Notification SMS failed for ${to} (schedule ${schedule._id}):`,
            smsResult && smsResult.error ? smsResult.error : "unknown error",
          );
        }
      }
    } catch (err) {
      console.error(
        `Failed to send assignment notifications for schedule ${schedule._id}:`,
        err && err.message ? err.message : err,
      );
    }

    res.status(201).json(schedule);
  } catch (err) {
    next(err);
  }
};

// LIST SCHEDULES
exports.getSchedules = async (req, res, next) => {
  try {
    const { staffId, role, from, to } = req.query;

    const filter = { tenantId: req.tenantId };
    if (staffId) filter.staffId = staffId;
    if (role) filter.role = role;

    if (from || to) {
      filter.$and = [];
      if (from) filter.$and.push({ endTime: { $gte: new Date(from) } });
      if (to) filter.$and.push({ startTime: { $lte: new Date(to) } });
    }

    const schedules = await Schedule.find(filter)
      .populate("staffId", "-passwordHash")
      .sort({ startTime: 1 });

    res.json(schedules);
  } catch (err) {
    next(err);
  }
};

// GET ONE
exports.getScheduleById = async (req, res, next) => {
  try {
    const schedule = await Schedule.findOne({
      _id: req.params.id,
      tenantId: req.tenantId,
    }).populate("staffId", "-passwordHash");

    if (!schedule)
      return res.status(404).json({ message: "Schedule not found" });

    res.json(schedule);
  } catch (err) {
    next(err);
  }
};

// UPDATE SCHEDULE
exports.updateSchedule = async (req, res, next) => {
  try {
    const updates = req.body;

    // If times change, check conflicts
    if (updates.startTime || updates.endTime || updates.staffId) {
      const sched = await Schedule.findById(req.params.id);
      if (!sched)
        return res.status(404).json({ message: "Schedule not found" });

      const startTime =
        updates.startTime !== undefined
          ? new Date(updates.startTime)
          : sched.startTime;

      const endTime =
        updates.endTime !== undefined
          ? new Date(updates.endTime)
          : sched.endTime;

      const staffId = updates.staffId || sched.staffId;

      const conflict = await hasConflict({
        tenantId: req.tenantId,
        staffId,
        startTime,
        endTime,
        excludeScheduleId: req.params.id,
      });

      if (conflict)
        return res.status(409).json({ message: "Schedule conflict", conflict });
    }

    const updated = await Schedule.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      updates,
      { new: true },
    ).populate("staffId", "-passwordHash");

    if (!updated)
      return res.status(404).json({ message: "Schedule not found" });

    res.json(updated);
  } catch (err) {
    next(err);
  }
};

// DELETE
exports.deleteSchedule = async (req, res, next) => {
  try {
    const deleted = await Schedule.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!deleted)
      return res.status(404).json({ message: "Schedule not found" });

    res.json({ message: "Schedule deleted" });
  } catch (err) {
    next(err);
  }
};
