const nodemailer = require("nodemailer");
const postmarkPkg = (() => {
  try {
    return require("postmark");
  } catch (e) {
    return null;
  }
})();

/**
 * sendEmail
 * ----------
 * Sends an email to staff. Prefers Postmark when
 * POSTMARK_API_TOKEN is present; falls back to SMTP via nodemailer.
 *
 * @param {string|string[]} to - Recipient email or list
 * @param {string} subject - Email subject
 * @param {string} html - HTML content of the email
 * @param {string} [text] - Optional plaintext body
 */
exports.sendEmail = async (to, subject, html, text) => {
  const recipients = Array.isArray(to) ? to.join(",") : to;

  // Track last error for diagnostic return
  let lastError = null;

  // Use Postmark when a token is configured.
  // If postmark package isn't installed, return a helpful error instead
  // of silently falling back to a local SMTP server (which often doesn't exist).
  if (process.env.POSTMARK_API_TOKEN) {
    if (!postmarkPkg) {
      const msg =
        "Postmark client not installed. Please run `npm install postmark` or unset POSTMARK_API_TOKEN to use SMTP fallback.";
      console.error(`❌ ${msg}`);
      return { success: false, error: msg };
    }

    try {
      const client = new postmarkPkg.Client(process.env.POSTMARK_API_TOKEN);
      const from = process.env.POSTMARK_SENDER_EMAIL || process.env.EMAIL_USER;

      await client.sendEmail({
        From: from,
        To: recipients,
        Subject: subject,
        HtmlBody: html,
        TextBody: text || undefined,
      });

      console.log(`✅ Email (Postmark) sent to ${recipients}`);
      return { success: true, provider: "postmark" };
    } catch (err) {
      lastError = err;
      console.error(
        `❌ Postmark send failed for ${recipients}:`,
        err && err.message ? err.message : err,
      );

      // Only attempt SMTP fallback if explicitly allowed via env var to
      // avoid accidental attempts to connect to localhost:587.
      if (
        !process.env.EMAIL_FALLBACK_TO_SMTP ||
        process.env.EMAIL_FALLBACK_TO_SMTP !== "true"
      ) {
        return {
          success: false,
          error:
            lastError && lastError.message
              ? lastError.message
              : String(lastError),
        };
      }
      // otherwise continue to SMTP fallback
    }
  }

  // Fallback: nodemailer SMTP
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: process.env.EMAIL_PORT || 587,
      secure: process.env.EMAIL_SECURE === "true" || false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `"Your Clinic Name" <${process.env.EMAIL_USER}>`,
      to: recipients,
      subject,
      html,
      text: text || undefined,
    });

    console.log(`✅ Email (SMTP) sent to ${recipients}`);
    return { success: true, provider: "smtp", info };
  } catch (err) {
    lastError = lastError || err;
    console.error(
      `❌ Failed to send email to ${recipients}:`,
      err && err.message ? err.message : err,
    );
    return {
      success: false,
      error:
        lastError && lastError.message ? lastError.message : String(lastError),
    };
  }
};

// Keep backwards-compatible default for consumers using require('./sendEmail')
module.exports = {
  sendEmail: exports.sendEmail,
};
