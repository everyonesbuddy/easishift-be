const twilioPkg = (() => {
  try {
    return require("twilio");
  } catch (e) {
    return null;
  }
})();

/**
 * sendSMS
 * ---------
 * Sends an SMS
 *
 * @param {string} to - Recipient phone number (in E.164 format, e.g., +15555555555)
 * @param {string} body - SMS message content
 */
const sendSMS = async (to, body) => {
  try {
    if (!twilioPkg) {
      const msg =
        "Twilio client not installed. Please run `npm install twilio`.";
      console.error(`❌ ${msg}`);
      return { success: false, error: msg };
    }

    if (
      !process.env.TWILIO_ACCOUNT_SID ||
      !process.env.TWILIO_AUTH_TOKEN ||
      !process.env.TWILIO_PHONE_NUMBER
    ) {
      const msg =
        "Missing Twilio env vars. Required: TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER.";
      console.error(`❌ ${msg}`);
      return { success: false, error: msg };
    }

    const client = twilioPkg(
      process.env.TWILIO_SID,
      process.env.TWILIO_AUTH_TOKEN,
    );

    await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });

    console.log(`✅ SMS sent to ${to}`);
    return { success: true, provider: "twilio" };
  } catch (err) {
    console.error(`❌ Failed to send SMS to ${to}:`, err.message);
    return { success: false, error: err && err.message ? err.message : err };
  }
};

module.exports = {
  sendSMS,
  default: sendSMS,
};
