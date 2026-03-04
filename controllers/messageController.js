const Message = require("../models/messageModel");

// 📥 Get all messages for a tenant
exports.getMessages = async (req, res, next) => {
  try {
    const messages = await Message.find({ tenantId: req.tenantId })
      .populate("senderId", "name role email")
      .populate("receiverId", "name role email")
      .sort({ createdAt: -1 });

    res.json(messages);
  } catch (err) {
    next(err);
  }
};

// 📥 Get messages by receiver
exports.getMessagesByReceiver = async (req, res, next) => {
  try {
    const messages = await Message.find({
      receiverId: req.params.receiverId,
      tenantId: req.tenantId,
    })
      .populate("senderId", "name role email")
      .sort({ createdAt: -1 });

    res.json(messages);
  } catch (err) {
    next(err);
  }
};

// 📤 Get messages by sender
exports.getMessagesBySender = async (req, res, next) => {
  try {
    const messages = await Message.find({
      senderId: req.params.senderId,
      tenantId: req.tenantId,
    })
      .populate("receiverId", "name role email")
      .sort({ createdAt: -1 });

    res.json(messages);
  } catch (err) {
    next(err);
  }
};

// ✉️ Create message
exports.createMessage = async (req, res, next) => {
  try {
    const { receiverIds = [], ...messageData } = req.body;

    if (!Array.isArray(receiverIds)) {
      return res.status(400).json({ message: "receiverIds must be an array" });
    }

    const recipients = [...new Set(receiverIds.map((id) => id.toString()))];

    if (!recipients.length) {
      return res
        .status(400)
        .json({ message: "At least one receiver is required" });
    }

    const messagesToCreate = recipients.map((recipientId) => ({
      ...messageData,
      receiverId: recipientId,
      tenantId: req.tenantId,
    }));

    const createdMessages = await Message.insertMany(messagesToCreate);

    if (createdMessages.length === 1) {
      return res.status(201).json(createdMessages[0]);
    }

    res.status(201).json(createdMessages);
  } catch (err) {
    next(err);
  }
};

// 📌 Mark message as read
exports.markMessageRead = async (req, res, next) => {
  try {
    const message = await Message.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId },
      { read: true },
      { new: true },
    );

    if (!message) return res.status(404).json({ message: "Message not found" });

    res.json(message);
  } catch (err) {
    next(err);
  }
};

// 🗑 Delete message
exports.deleteMessage = async (req, res, next) => {
  try {
    const message = await Message.findOneAndDelete({
      _id: req.params.id,
      tenantId: req.tenantId,
    });

    if (!message) return res.status(404).json({ message: "Message not found" });

    res.json({ message: "Message deleted" });
  } catch (err) {
    next(err);
  }
};
