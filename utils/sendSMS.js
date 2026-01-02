const twilio = require("twilio");

// Initialize Twilio client
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * sendSMS
 * ---------
 * Sends an SMS to a patient or staff.
 *
 * @param {string} to - Recipient phone number (in E.164 format, e.g., +15555555555)
 * @param {string} body - SMS message content
 */
const sendSMS = async (to, body) => {
  try {
    await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });

    console.log(`✅ SMS sent to ${to}`);
  } catch (err) {
    console.error(`❌ Failed to send SMS to ${to}:`, err.message);
  }
};

module.exports = sendSMS;
