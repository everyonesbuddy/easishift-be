const mongoose = require("mongoose");
const Message = require("../models/messageModel");
const User = require("../models/userModel");
const { hasPermission } = require("../config/authorization");

// Managers (messages.manage) see every message in their workspace.
// Everyone else only sees messages they sent or received.
const canManageMessages = (user) => hasPermission(user, "messages.manage");

const ownMessagesFilter = (req) => ({
  tenantId: req.tenantId,
  $or: [{ senderId: req.user._id }, { receiverId: req.user._id }],
});

// 📥 Get all messages visible to the caller
exports.getMessages = async (req, res, next) => {
  try {
    const filter = canManageMessages(req.user)
      ? { tenantId: req.tenantId }
      : ownMessagesFilter(req);

    const messages = await Message.find(filter)
      .populate("senderId", "name role email")
      .populate("receiverId", "name role email")
      .sort({ createdAt: -1 });

    res.json(messages);
  } catch (err) {
    next(err);
  }
};

// 📥 Get messages by receiver (non-managers can only ask for their own inbox)
exports.getMessagesByReceiver = async (req, res, next) => {
  try {
    const receiverId = canManageMessages(req.user)
      ? req.params.receiverId
      : req.user._id;

    const messages = await Message.find({
      receiverId,
      tenantId: req.tenantId,
    })
      .populate("senderId", "name role email")
      .sort({ createdAt: -1 });

    res.json(messages);
  } catch (err) {
    next(err);
  }
};

// 📤 Get messages by sender (non-managers can only ask for their own outbox)
exports.getMessagesBySender = async (req, res, next) => {
  try {
    const senderId = canManageMessages(req.user)
      ? req.params.senderId
      : req.user._id;

    const messages = await Message.find({
      senderId,
      tenantId: req.tenantId,
    })
      .populate("receiverId", "name role email")
      .sort({ createdAt: -1 });

    res.json(messages);
  } catch (err) {
    next(err);
  }
};

// ✉️ Create message — the sender is always the caller, and every receiver
// must belong to the caller's workspace.
exports.createMessage = async (req, res, next) => {
  try {
    const { receiverIds = [], subject, body } = req.body;

    if (!Array.isArray(receiverIds)) {
      return res.status(400).json({ message: "receiverIds must be an array" });
    }

    const recipients = [...new Set(receiverIds.map((id) => String(id)))];

    if (!recipients.length) {
      return res
        .status(400)
        .json({ message: "At least one receiver is required" });
    }

    if (recipients.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: "Invalid receiver id" });
    }

    const validReceivers = await User.countDocuments({
      _id: { $in: recipients },
      tenantId: req.tenantId,
    });
    if (validReceivers !== recipients.length) {
      return res
        .status(400)
        .json({ message: "One or more receivers were not found" });
    }

    const messagesToCreate = recipients.map((recipientId) => ({
      subject,
      body,
      senderId: req.user._id,
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

// 📌 Mark message as read (only the receiver can)
exports.markMessageRead = async (req, res, next) => {
  try {
    const message = await Message.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.tenantId, receiverId: req.user._id },
      { read: true },
      { new: true },
    );

    if (!message) return res.status(404).json({ message: "Message not found" });

    res.json(message);
  } catch (err) {
    next(err);
  }
};

// 🗑 Delete message (sender, receiver, or a manager)
exports.deleteMessage = async (req, res, next) => {
  try {
    const filter = canManageMessages(req.user)
      ? { _id: req.params.id, tenantId: req.tenantId }
      : { _id: req.params.id, ...ownMessagesFilter(req) };

    const message = await Message.findOneAndDelete(filter);

    if (!message) return res.status(404).json({ message: "Message not found" });

    res.json({ message: "Message deleted" });
  } catch (err) {
    next(err);
  }
};
