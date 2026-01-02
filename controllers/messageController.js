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
    const message = await Message.create({
      ...req.body,
      tenantId: req.tenantId,
    });

    res.status(201).json(message);
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
      { new: true }
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
