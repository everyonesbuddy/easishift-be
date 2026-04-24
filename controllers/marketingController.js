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
      source,
      calculatorType,
      inputs = {},
      outputs = {},
      costDrivers = [],
      meta = {},
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
            label: escapeHtml(item.label.trim() || "Cost driver"),
            value: asNumber(item.value, 0),
          }))
      : [];

    const safeSource = escapeHtml(source || "turnover-roi-calculator");
    const safeCalculatorType = escapeHtml(calculatorType || "ltc-turnover-roi");

    const sentAt = meta && meta.sentAt ? new Date(meta.sentAt) : new Date();
    const sentAtLabel = Number.isNaN(sentAt.getTime())
      ? new Date().toISOString()
      : sentAt.toISOString();

    const subject = "Your LTC Turnover ROI Summary";

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;max-width:680px;margin:0 auto;">
        <h2 style="margin:0 0 8px 0;">LTC Turnover ROI Summary</h2>
        <p style="margin:0 0 16px 0;color:#334155;">Thanks for using the Easishift turnover ROI calculator. Here is a copy of your results.</p>

        <h3 style="margin:20px 0 8px 0;">Facility Inputs</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#475569;">Employees</td><td style="padding:6px 0;text-align:right;font-weight:600;">${formatNumber(inputs.employees, 0)}</td></tr>
          <tr><td style="padding:6px 0;color:#475569;">Hourly wage</td><td style="padding:6px 0;text-align:right;font-weight:600;">${formatCurrency(inputs.hourlyWage)}</td></tr>
          <tr><td style="padding:6px 0;color:#475569;">Weekly hours</td><td style="padding:6px 0;text-align:right;font-weight:600;">${formatNumber(inputs.weeklyHours, 1)}</td></tr>
          <tr><td style="padding:6px 0;color:#475569;">Turnover rate</td><td style="padding:6px 0;text-align:right;font-weight:600;">${formatNumber(inputs.turnoverRate, 1)}%</td></tr>
          <tr><td style="padding:6px 0;color:#475569;">Vacancy days</td><td style="padding:6px 0;text-align:right;font-weight:600;">${formatNumber(inputs.vacancyDays, 0)}</td></tr>
        </table>

        <h3 style="margin:20px 0 8px 0;">Annual Impact</h3>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:6px 0;color:#475569;">Cost per turnover event</td><td style="padding:6px 0;text-align:right;font-weight:600;">${formatCurrency(outputs.costPerTurnoverEvent)}</td></tr>
          <tr><td style="padding:6px 0;color:#475569;">Annual turnover cost</td><td style="padding:6px 0;text-align:right;font-weight:600;">${formatCurrency(outputs.annualTurnoverCost)}</td></tr>
          <tr><td style="padding:6px 0;color:#475569;">Scheduling admin cost</td><td style="padding:6px 0;text-align:right;font-weight:600;">${formatCurrency(outputs.schedulingAdminCost)}</td></tr>
          <tr><td style="padding:6px 0;color:#475569;">Total annual cost</td><td style="padding:6px 0;text-align:right;font-weight:700;">${formatCurrency(outputs.totalCost)}</td></tr>
          <tr><td style="padding:6px 0;color:#166534;">Projected savings</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#166534;">${formatCurrency(outputs.projectedSavings)}/yr</td></tr>
        </table>

        ${
          normalizedCostDrivers.length
            ? `<h3 style="margin:20px 0 8px 0;">Cost Drivers</h3>
               <table style="width:100%;border-collapse:collapse;">
                 ${normalizedCostDrivers
                   .map(
                     (driver) =>
                       `<tr>
                          <td style="padding:6px 0;color:#475569;">${driver.label}</td>
                          <td style="padding:6px 0;text-align:right;font-weight:600;">${formatCurrency(driver.value)}</td>
                        </tr>`,
                   )
                   .join("")}
               </table>`
            : ""
        }

        <p style="margin:24px 0 8px 0;color:#64748b;font-size:12px;">
          Source: ${safeSource} | Calculator: ${safeCalculatorType}
        </p>
        <p style="margin:0;color:#64748b;font-size:12px;">Generated at: ${sentAtLabel}</p>
      </div>
    `;

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
      `Source: ${source || "turnover-roi-calculator"}`,
      `Calculator: ${calculatorType || "ltc-turnover-roi"}`,
      `Generated at: ${sentAtLabel}`,
    ].join("\n");

    const emailResult = await sendEmail(
      recipientEmail.trim(),
      subject,
      html,
      text,
    );

    if (!emailResult || !emailResult.success) {
      return res.status(502).json({
        message: "Failed to send summary email",
        error:
          emailResult && emailResult.error
            ? emailResult.error
            : "Email provider error",
      });
    }

    return res.status(200).json({ message: "Summary email sent successfully" });
  } catch (err) {
    next(err);
  }
};
