const express = require("express");
const router = express.Router();
const {
  getMessages,
  createMessage,
  getMessagesByReceiver,
  getMessagesBySender,
  markMessageRead,
  deleteMessage,
} = require("../controllers/messageController");

const auth = require("../middleware/authMiddleware");
const { requireFeature } = require("../middleware/planMiddleware");
const tenant = require("../middleware/tenantMiddleware");

router.use(auth, tenant, requireFeature("messaging"));

router.route("/").get(getMessages).post(createMessage);
router.get("/receiver/:receiverId", getMessagesByReceiver);
router.get("/sender/:senderId", getMessagesBySender);
router.put("/:id/read", markMessageRead);
router.delete("/:id", deleteMessage);

module.exports = router;
