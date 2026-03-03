const Message = require("../models/messageModel");
const { sendSMS } = require("./sendSMS");

// Check for scheduled reminders and send via Twilio
exports.sendPendingReminders = async () => {
  const pendingMessages = await Message.find({ status: "pending" });
  for (const msg of pendingMessages) {
    try {
      const result = await sendSMS(msg.patientId, msg.content);
      if (!result || !result.success) {
        msg.status = "failed";
        await msg.save();
        console.error(
          `🚫 Failed to send message to ${msg.patientId}: ${
            result && result.error ? result.error : "unknown error"
          }`,
        );
        continue;
      }

      msg.status = "sent";
      msg.sentAt = new Date();
      await msg.save();
      console.log(`✅ Message sent to patient ${msg.patientId}`);
    } catch (err) {
      msg.status = "failed";
      await msg.save();
      console.error(`🚫 Failed to send message: ${err.message}`);
    }
  }
};
