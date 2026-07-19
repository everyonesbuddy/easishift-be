const nodemailer = require("nodemailer");
const postmarkPkg = (() => {
  try {
    return require("postmark");
  } catch (e) {
    return null;
  }
})();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const EMAIL_RATE_LIMIT_PER_DOMAIN_MS = parsePositiveInt(
  process.env.EMAIL_RATE_LIMIT_PER_DOMAIN_MS,
  1000,
);
const EMAIL_RATE_LIMIT_GLOBAL_MS = parsePositiveInt(
  process.env.EMAIL_RATE_LIMIT_GLOBAL_MS,
  250,
);
const EMAIL_RETRY_MAX_ATTEMPTS = parsePositiveInt(
  process.env.EMAIL_RETRY_MAX_ATTEMPTS,
  5,
);
const EMAIL_RETRY_BASE_DELAY_MS = parsePositiveInt(
  process.env.EMAIL_RETRY_BASE_DELAY_MS,
  30 * 1000,
);

const domainNextAllowedAt = new Map();
let globalNextAllowedAt = 0;
let queueTail = Promise.resolve();

const getRecipientDomains = (to) => {
  const list = Array.isArray(to) ? to : String(to || "").split(",");
  return Array.from(
    new Set(
      list
        .map((item) =>
          String(item || "")
            .trim()
            .toLowerCase(),
        )
        .map((item) => item.split("@")[1])
        .filter(Boolean),
    ),
  );
};

const isTransientError = (err) => {
  const message = String(
    (err && (err.message || err.statusMessage || err.code)) || err || "",
  ).toLowerCase();

  return (
    /\b4\.7\.\d+\b/.test(message) ||
    /rate\s*limit/.test(message) ||
    /temporar/.test(message) ||
    /try again later/.test(message) ||
    /throttl/.test(message) ||
    /timeout|timed out|econnreset|eai_again|etimedout/.test(message)
  );
};

const sendViaConfiguredProvider = async (to, subject, html, text) => {
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

const sendWithRetry = async (to, subject, html, text, options = {}) => {
  const maxAttempts = parsePositiveInt(
    options.maxAttempts,
    EMAIL_RETRY_MAX_ATTEMPTS,
  );
  const baseDelayMs = parsePositiveInt(
    options.baseDelayMs,
    EMAIL_RETRY_BASE_DELAY_MS,
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await sendViaConfiguredProvider(to, subject, html, text);
    if (result && result.success) {
      return result;
    }

    const err = result && result.error ? result.error : "unknown email error";
    if (attempt === maxAttempts || !isTransientError(err)) {
      return result;
    }

    const jitterMs = Math.floor(Math.random() * 1000);
    const backoffMs = baseDelayMs * Math.pow(2, attempt - 1) + jitterMs;
    console.warn(
      `⚠️ Email transient failure. Retry ${attempt + 1}/${maxAttempts} in ${Math.floor(
        backoffMs / 1000,
      )}s`,
    );
    await sleep(backoffMs);
  }

  return { success: false, error: "email retries exhausted" };
};

const queueAndRateLimit = async (to, job, options = {}) => {
  const domains = getRecipientDomains(to);
  const globalGapMs = parsePositiveInt(
    options.globalMinIntervalMs,
    EMAIL_RATE_LIMIT_GLOBAL_MS,
  );
  const perDomainGapMs = parsePositiveInt(
    options.perDomainMinIntervalMs,
    EMAIL_RATE_LIMIT_PER_DOMAIN_MS,
  );

  const queuedJob = queueTail.then(async () => {
    const now = Date.now();
    let allowedAt = Math.max(now, globalNextAllowedAt);

    for (const domain of domains) {
      allowedAt = Math.max(allowedAt, domainNextAllowedAt.get(domain) || 0);
    }

    const waitMs = allowedAt - now;
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    const sentAt = Date.now();
    globalNextAllowedAt = sentAt + globalGapMs;
    for (const domain of domains) {
      domainNextAllowedAt.set(domain, sentAt + perDomainGapMs);
    }

    return job();
  });

  queueTail = queuedJob.catch((err) => {
    console.error(
      "❌ Email queue error:",
      err && err.message ? err.message : err,
    );
  });

  return queuedJob;
};

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
exports.sendEmail = async (to, subject, html, text) =>
  sendViaConfiguredProvider(to, subject, html, text);

exports.sendEmailQueued = async (to, subject, html, text, options = {}) =>
  queueAndRateLimit(
    to,
    () => sendWithRetry(to, subject, html, text, options),
    options,
  );

// Keep backwards-compatible default for consumers using require('./sendEmail')
module.exports = {
  sendEmail: exports.sendEmail,
  sendEmailQueued: exports.sendEmailQueued,
};
