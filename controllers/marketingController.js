const { sendEmail } = require("../utils/sendEmail");

const MAX_EMAIL_LENGTH = 254;

const isValidEmail = (value = "") => {
  if (typeof value !== "string") return false;
  const email = value.trim();
  if (!email || email.length > MAX_EMAIL_LENGTH) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const escapeHtml = (value = "") => {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const formatCurrency = (value) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.max(0, asNumber(value, 0)));
};

const formatNumber = (value, fractionDigits = 2) => {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: fractionDigits,
  }).format(asNumber(value, 0));
};

exports.sendTurnoverRoiEmailSummary = async (req, res, next) => {
  try {
    const {
      recipientEmail,
      inputs = {},
      outputs = {},
      costDrivers = [],
    } = req.body || {};

    if (!isValidEmail(recipientEmail)) {
      return res
        .status(400)
        .json({ message: "A valid recipientEmail is required" });
    }

    const normalizedCostDrivers = Array.isArray(costDrivers)
      ? costDrivers
          .filter((item) => item && typeof item.label === "string")
          .map((item) => ({
            label: item.label.trim() || "Cost driver",
            value: asNumber(item.value, 0),
          }))
      : [];
    const inputRows = [
      ["Employees", formatNumber(inputs.employees, 0)],
      ["Average hourly wage", formatCurrency(inputs.hourlyWage)],
      ["Weekly hours", `${formatNumber(inputs.weeklyHours, 1)} hours`],
      ["Annual turnover rate", `${formatNumber(inputs.turnoverRate, 1)}%`],
      ["Average vacancy", `${formatNumber(inputs.vacancyDays, 0)} days`],
    ];
    const resultRows = [
      ["Cost per turnover event", formatCurrency(outputs.costPerTurnoverEvent)],
      ["Annual turnover cost", formatCurrency(outputs.annualTurnoverCost)],
      ["Scheduling admin cost", formatCurrency(outputs.schedulingAdminCost)],
      ["Total annual cost", formatCurrency(outputs.totalCost)],
      ["Projected savings", `${formatCurrency(outputs.projectedSavings)}/year`],
    ];
    const extraRows = normalizedCostDrivers.map((driver) => [
      driver.label,
      formatCurrency(driver.value),
    ]);
    const calculatorUrl =
      "https://wisershifts.com/calculators/turnover-roi-calculator";
    const html = buildCalculatorEmail({
      eyebrow: "LTC turnover ROI calculator",
      title: "Your turnover ROI summary",
      intro:
        "A practical view of the annual cost of turnover and the savings available when scheduling work becomes easier to manage.",
      totalLabel: "Estimated annual turnover and scheduling cost",
      totalValue: formatCurrency(outputs.totalCost),
      accent: "#7c3aed",
      accentSoft: "#ede9fe",
      accentDark: "#5b21b6",
      inputRows,
      resultRows,
      extraTitle: "Cost drivers",
      extraRows,
      insight: `Your projected opportunity is ${formatCurrency(outputs.projectedSavings)} per year. WiserShifts helps teams reduce scheduling friction, surface gaps earlier, and make open shifts easier to fill.`,
      disclaimer:
        "This estimate reflects the assumptions supplied to the calculator. Actual turnover costs and savings will vary by facility.",
      calculatorUrl,
    });

    const text = [
      "LTC Turnover ROI Summary",
      "",
      "Facility Inputs",
      `- Employees: ${formatNumber(inputs.employees, 0)}`,
      `- Hourly wage: ${formatCurrency(inputs.hourlyWage)}`,
      `- Weekly hours: ${formatNumber(inputs.weeklyHours, 1)}`,
      `- Turnover rate: ${formatNumber(inputs.turnoverRate, 1)}%`,
      `- Vacancy days: ${formatNumber(inputs.vacancyDays, 0)}`,
      "",
      "Annual Impact",
      `- Cost per turnover event: ${formatCurrency(outputs.costPerTurnoverEvent)}`,
      `- Annual turnover cost: ${formatCurrency(outputs.annualTurnoverCost)}`,
      `- Scheduling admin cost: ${formatCurrency(outputs.schedulingAdminCost)}`,
      `- Total annual cost: ${formatCurrency(outputs.totalCost)}`,
      `- Projected savings: ${formatCurrency(outputs.projectedSavings)}/yr`,
      "",
      ...extraRows.map(([label, value]) => `${label}: ${value}`),
      "",
      `Review your results: ${calculatorUrl}`,
      "Book your free scheduling audit: https://calendly.com/wisershifts-info/30min",
    ].join("\n");

    return await sendCalculatorSummary({
      recipientEmail,
      subject: "Your LTC Turnover ROI Summary | WiserShifts",
      html,
      text,
      res,
    });
  } catch (err) {
    next(err);
  }
};

exports.sendCostLeakEmailSummary = async (req, res, next) => {
  try {
    const { recipientEmail, inputs = {}, outputs = {} } = req.body || {};

    if (!isValidEmail(recipientEmail)) {
      return res
        .status(400)
        .json({ message: "A valid recipientEmail is required" });
    }

    const savingsRateLabel = `${formatNumber(outputs.savingsRate * 100, 0)}%`;
    const inputRows = [
      ["Employees", formatNumber(inputs.employees, 0)],
      ["Average hourly wage", formatCurrency(inputs.hourlyWage)],
      ["Overtime cost", `${formatCurrency(inputs.overtimeCostPerWeek)}/week`],
      [
        "Temporary labor spend",
        `${formatCurrency(inputs.tempMonthlySpend)}/month`,
      ],
      [
        "Scheduling and admin time",
        `${formatNumber(inputs.schedulingHoursPerWeek, 1)} hours/week`,
      ],
    ];
    const resultRows = [
      ["Overtime cost leak", formatCurrency(outputs.overtimeCostLeak)],
      [
        "Temporary labor premium leak",
        formatCurrency(outputs.temporaryPremiumLeak),
      ],
      [
        "Scheduling coordination leak",
        formatCurrency(outputs.schedulingCoordinationLeak),
      ],
      ["Total annual leak", formatCurrency(outputs.totalAnnualLeak)],
      [
        `Projected savings (${savingsRateLabel})`,
        `${formatCurrency(outputs.projectedSavings)}/year`,
      ],
    ];
    const calculatorUrl =
      "https://wisershifts.com/calculators/cost-leak-calculator";
    const html = buildCalculatorEmail({
      eyebrow: "Labor cost leak calculator",
      title: "Your labor cost leak summary",
      intro:
        "A simple breakdown of where avoidable labor costs may be accumulating across overtime, temporary staffing, and coordination work.",
      totalLabel: "Estimated total annual labor cost leak",
      totalValue: formatCurrency(outputs.totalAnnualLeak),
      accent: "#ea580c",
      accentSoft: "#ffedd5",
      accentDark: "#9a3412",
      inputRows,
      resultRows,
      insight: `At the selected ${savingsRateLabel} opportunity rate, the projected savings are ${formatCurrency(outputs.projectedSavings)} per year. WiserShifts helps expose staffing gaps sooner and reduce manual coordination work.`,
      disclaimer:
        "This estimate reflects the assumptions supplied to the calculator and is intended for planning purposes. Actual costs and savings may vary.",
      calculatorUrl,
    });

    const text = [
      "Labor Cost Leak Summary",
      "",
      "Your Inputs",
      `- Employees: ${formatNumber(inputs.employees, 0)}`,
      `- Average hourly wage: ${formatCurrency(inputs.hourlyWage)}`,
      `- Overtime cost per week: ${formatCurrency(inputs.overtimeCostPerWeek)}`,
      `- Monthly temporary spend: ${formatCurrency(inputs.tempMonthlySpend)}`,
      `- Scheduling/admin hours per week: ${formatNumber(inputs.schedulingHoursPerWeek, 1)}`,
      "",
      "Annual Cost Leak Estimate",
      `- Overtime cost leak: ${formatCurrency(outputs.overtimeCostLeak)}`,
      `- Temporary labor premium leak: ${formatCurrency(outputs.temporaryPremiumLeak)}`,
      `- Scheduling coordination leak: ${formatCurrency(outputs.schedulingCoordinationLeak)}`,
      `- Total annual leak: ${formatCurrency(outputs.totalAnnualLeak)}`,
      `- Projected savings (${savingsRateLabel}): ${formatCurrency(outputs.projectedSavings)}/yr`,
      "",
      `Review your results: ${calculatorUrl}`,
      "Book your free scheduling audit: https://calendly.com/wisershifts-info/30min",
    ].join("\n");

    return await sendCalculatorSummary({
      recipientEmail,
      subject: "Your Labor Cost Leak Summary | WiserShifts",
      html,
      text,
      res,
    });
  } catch (err) {
    next(err);
  }
};

const WEEKS_PER_YEAR = 52;

const clampNumber = (value, fallback, min, max) => {
  const parsed = asNumber(value, fallback);
  return Math.min(max, Math.max(min, parsed));
};

const detailRows = (rows) =>
  rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#475569;font-size:14px;">${escapeHtml(label)}</td>
          <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:14px;font-weight:700;text-align:right;">${escapeHtml(value)}</td>
        </tr>`,
    )
    .join("");

const buildCalculatorEmail = ({
  eyebrow,
  title,
  intro,
  totalLabel,
  totalValue,
  accent,
  accentSoft,
  accentDark,
  inputRows,
  resultRows,
  extraTitle,
  extraRows = [],
  insight,
  disclaimer,
  calculatorUrl,
}) => `
  <!doctype html>
  <html lang="en">
    <body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #e2e8f0;">
              <tr>
                <td style="padding:30px 34px;background:#0f172a;border-top:6px solid ${accent};">
                  <a href="https://wisershifts.com" aria-label="WiserShifts" style="display:inline-block;margin:0 0 20px;color:#ffffff;font-size:22px;font-weight:800;line-height:1;text-decoration:none;"><span style="color:#ffffff;">Wiser</span><span style="color:#60a5fa;">Shifts</span></a>
                  <p style="margin:0 0 10px;color:${accentSoft};font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                  <h1 style="margin:0;color:#ffffff;font-size:28px;line-height:1.2;letter-spacing:0;">${escapeHtml(title)}</h1>
                  <p style="margin:12px 0 0;color:#cbd5e1;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:28px 34px 8px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${accentSoft};border-left:5px solid ${accent};">
                    <tr>
                      <td style="padding:20px 22px;">
                        <p style="margin:0 0 5px;color:${accentDark};font-size:13px;font-weight:700;">${escapeHtml(totalLabel)}</p>
                        <p style="margin:0;color:#0f172a;font-size:38px;line-height:1;font-weight:800;letter-spacing:0;">${escapeHtml(totalValue)}</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 34px 0;">
                  <h2 style="margin:0 0 4px;font-size:17px;line-height:1.3;">Your inputs</h2>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${detailRows(inputRows)}</table>
                </td>
              </tr>
              <tr>
                <td style="padding:28px 34px 0;">
                  <h2 style="margin:0 0 4px;font-size:17px;line-height:1.3;">Annual impact</h2>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${detailRows(resultRows)}</table>
                </td>
              </tr>
              ${
                extraRows.length
                  ? `<tr>
                       <td style="padding:28px 34px 0;">
                         <h2 style="margin:0 0 4px;font-size:17px;line-height:1.3;">${escapeHtml(extraTitle || "Additional details")}</h2>
                         <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${detailRows(extraRows)}</table>
                       </td>
                     </tr>`
                  : ""
              }
              <tr>
                <td style="padding:24px 34px 0;">
                  <p style="margin:0;padding:16px 18px;background:#f8fafc;border-left:4px solid ${accent};color:#334155;font-size:14px;line-height:1.6;">${escapeHtml(insight)}</p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:28px 34px;">
                  <p style="margin:0 0 14px;color:#0f172a;font-size:17px;font-weight:700;line-height:1.4;">See where your scheduling process can improve.</p>
                  <a href="https://calendly.com/wisershifts-info/30min" style="display:inline-block;padding:13px 22px;background:${accent};color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Book your free scheduling audit &rarr;</a>
                  <p style="margin:16px 0 0;font-size:13px;"><a href="${escapeHtml(calculatorUrl)}" style="color:${accentDark};font-weight:700;text-decoration:underline;">Review or update your calculator results</a></p>
                  <p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.55;">${escapeHtml(disclaimer)}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 34px;background:#0f172a;color:#94a3b8;font-size:12px;text-align:center;">
                  <a href="https://wisershifts.com" style="color:#ffffff;font-weight:700;text-decoration:none;">WiserShifts</a> &middot; Clearer schedules. Faster coverage. Less scrambling.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>`;

const sendCalculatorSummary = async ({
  recipientEmail,
  subject,
  html,
  text,
  res,
}) => {
  const emailResult = await sendEmail(
    recipientEmail.trim(),
    subject,
    html,
    text,
  );

  if (!emailResult || !emailResult.success) {
    return res.status(502).json({
      message: "Failed to send summary email",
      error: emailResult?.error || "Email provider error",
    });
  }

  return res.status(200).json({ message: "Summary email sent successfully" });
};

exports.sendCallOutCostEmailSummary = async (req, res, next) => {
  try {
    const { recipientEmail, inputs = {} } = req.body || {};

    if (!isValidEmail(recipientEmail)) {
      return res
        .status(400)
        .json({ message: "A valid recipientEmail is required" });
    }

    const employees = clampNumber(inputs.employees, 50, 10, 1500);
    const hourlyWage = clampNumber(inputs.hourlyWage, 22, 10, 100);
    const callOutsPerWeek = clampNumber(inputs.callOutsPerWeek, 5, 0, 100);
    const shiftLength = clampNumber(inputs.shiftLength, 8, 1, 24);
    const fillDelayHours = clampNumber(inputs.fillDelayHours, 4, 0, 24);
    const overtimeMultiplier = clampNumber(
      inputs.overtimeMultiplier,
      1.5,
      1,
      3,
    );
    const agencyRate = clampNumber(inputs.agencyRate, 75, 20, 250);
    const managerMinutes = clampNumber(inputs.managerMinutes, 30, 0, 180);
    const managerHourlyRate = clampNumber(
      inputs.managerHourlyRate,
      25,
      10,
      150,
    );
    const requestedCoverage = {
      overtimePercent: clampNumber(inputs.overtimePercent, 60, 0, 100),
      agencyPercent: clampNumber(inputs.agencyPercent, 30, 0, 100),
      unfilledPercent: clampNumber(inputs.unfilledPercent, 10, 0, 100),
    };
    const coverageTotal = Object.values(requestedCoverage).reduce(
      (sum, value) => sum + value,
      0,
    );
    const coverage =
      Math.abs(coverageTotal - 100) < 0.01
        ? requestedCoverage
        : { overtimePercent: 60, agencyPercent: 30, unfilledPercent: 10 };

    const weeklyCallOutHours = callOutsPerWeek * shiftLength;
    const annualOvertimeCost =
      weeklyCallOutHours *
      (coverage.overtimePercent / 100) *
      hourlyWage *
      overtimeMultiplier *
      WEEKS_PER_YEAR;
    const annualAgencyCost =
      weeklyCallOutHours *
      (coverage.agencyPercent / 100) *
      agencyRate *
      WEEKS_PER_YEAR;
    const annualManagerTimeCost =
      (managerMinutes / 60) *
      callOutsPerWeek *
      managerHourlyRate *
      WEEKS_PER_YEAR;
    const totalAnnualCost =
      annualOvertimeCost + annualAgencyCost + annualManagerTimeCost;
    const annualUnfilledShiftCount =
      callOutsPerWeek * (coverage.unfilledPercent / 100) * WEEKS_PER_YEAR;

    const inputRows = [
      ["Employees", formatNumber(employees, 0)],
      ["Average hourly wage", formatCurrency(hourlyWage)],
      ["Call-outs per week", formatNumber(callOutsPerWeek, 1)],
      ["Average shift length", `${formatNumber(shiftLength, 1)} hours`],
      ["Typical fill delay", `${formatNumber(fillDelayHours, 1)} hours`],
      [
        "Coverage mix",
        `${formatNumber(coverage.overtimePercent, 0)}% overtime / ${formatNumber(coverage.agencyPercent, 0)}% agency / ${formatNumber(coverage.unfilledPercent, 0)}% unfilled`,
      ],
    ];
    const resultRows = [
      ["Overtime cost", formatCurrency(annualOvertimeCost)],
      ["Agency cost", formatCurrency(annualAgencyCost)],
      ["Manager coordination time", formatCurrency(annualManagerTimeCost)],
      [
        "Uncovered shifts",
        `${formatNumber(annualUnfilledShiftCount, 1)} per year`,
      ],
    ];
    const calculatorUrl =
      "https://wisershifts.com/calculators/call-out-cost-calculator";
    const html = buildCalculatorEmail({
      eyebrow: "Call-out cost calculator",
      title: "Your call-out cost summary",
      intro:
        "A clear view of what last-minute coverage may be costing your facility each year.",
      totalLabel: "Estimated annual cost of covering call-outs",
      totalValue: formatCurrency(totalAnnualCost),
      accent: "#2563eb",
      accentSoft: "#dbeafe",
      accentDark: "#1e40af",
      inputRows,
      resultRows,
      insight: `${formatNumber(annualUnfilledShiftCount, 1)} shifts may go uncovered each year. That operational impact is shown separately and is not assigned a dollar value above.`,
      disclaimer:
        "These estimates use the assumptions you entered and standard overtime and agency calculations. Actual costs may vary.",
      calculatorUrl,
    });
    const text = [
      "Your call-out cost summary",
      `Estimated annual cost: ${formatCurrency(totalAnnualCost)}`,
      "",
      ...inputRows.map(([label, value]) => `${label}: ${value}`),
      "",
      ...resultRows.map(([label, value]) => `${label}: ${value}`),
      "",
      `Review your results: ${calculatorUrl}`,
      "Book your free scheduling audit: https://calendly.com/wisershifts-info/30min",
    ].join("\n");

    return await sendCalculatorSummary({
      recipientEmail,
      subject: "Your Call-Out Cost Summary | WiserShifts",
      html,
      text,
      res,
    });
  } catch (err) {
    next(err);
  }
};

exports.sendOvertimeCostEmailSummary = async (req, res, next) => {
  try {
    const { recipientEmail, inputs = {} } = req.body || {};

    if (!isValidEmail(recipientEmail)) {
      return res
        .status(400)
        .json({ message: "A valid recipientEmail is required" });
    }

    const employees = clampNumber(inputs.employees, 50, 10, 1500);
    const hourlyWage = clampNumber(inputs.hourlyWage, 22, 10, 100);
    const overtimeHours = clampNumber(inputs.overtimeHours, 40, 0, 1000);
    const reactivePercent = clampNumber(inputs.reactivePercent, 40, 0, 100);
    const overtimeMultiplier = clampNumber(
      inputs.overtimeMultiplier,
      1.5,
      1,
      3,
    );
    const weeklyReactiveHours = overtimeHours * (reactivePercent / 100);
    const weeklyPlannedHours = overtimeHours - weeklyReactiveHours;
    const annualReactiveCost =
      weeklyReactiveHours * hourlyWage * overtimeMultiplier * WEEKS_PER_YEAR;
    const annualPlannedCost =
      weeklyPlannedHours * hourlyWage * overtimeMultiplier * WEEKS_PER_YEAR;
    const totalAnnualCost = annualReactiveCost + annualPlannedCost;

    const inputRows = [
      ["Employees", formatNumber(employees, 0)],
      ["Average hourly wage", formatCurrency(hourlyWage)],
      ["Total overtime", `${formatNumber(overtimeHours, 1)} hours per week`],
      ["Reactive overtime", `${formatNumber(reactivePercent, 0)}%`],
      ["Overtime multiplier", `${formatNumber(overtimeMultiplier, 1)}x`],
    ];
    const resultRows = [
      [
        "Reactive overtime",
        `${formatNumber(weeklyReactiveHours, 1)} hours/week`,
      ],
      ["Reactive overtime cost", formatCurrency(annualReactiveCost)],
      ["Planned overtime", `${formatNumber(weeklyPlannedHours, 1)} hours/week`],
      ["Planned overtime cost", formatCurrency(annualPlannedCost)],
      ["Total overtime spend", formatCurrency(totalAnnualCost)],
    ];
    const calculatorUrl =
      "https://wisershifts.com/calculators/overtime-cost-calculator";
    const html = buildCalculatorEmail({
      eyebrow: "Overtime cost calculator",
      title: "Your reactive overtime summary",
      intro:
        "A focused look at the overtime tied to last-minute scheduling and coverage gaps.",
      totalLabel: "Estimated annual reactive overtime cost",
      totalValue: formatCurrency(annualReactiveCost),
      accent: "#0f766e",
      accentSoft: "#ccfbf1",
      accentDark: "#115e59",
      inputRows,
      resultRows,
      insight: `${formatNumber(reactivePercent, 0)}% of the overtime entered is attributed to reactive scheduling. Planned overtime remains visible but is not included in the highlighted amount.`,
      disclaimer:
        "This estimate reflects the assumptions you entered. It is intended to separate reactive overtime from planned staffing needs, not to represent guaranteed savings.",
      calculatorUrl,
    });
    const text = [
      "Your reactive overtime summary",
      `Estimated annual reactive overtime cost: ${formatCurrency(annualReactiveCost)}`,
      "",
      ...inputRows.map(([label, value]) => `${label}: ${value}`),
      "",
      ...resultRows.map(([label, value]) => `${label}: ${value}`),
      "",
      `Review your results: ${calculatorUrl}`,
      "Book your free scheduling audit: https://calendly.com/wisershifts-info/30min",
    ].join("\n");

    return await sendCalculatorSummary({
      recipientEmail,
      subject: "Your Reactive Overtime Cost Summary | WiserShifts",
      html,
      text,
      res,
    });
  } catch (err) {
    next(err);
  }
};
