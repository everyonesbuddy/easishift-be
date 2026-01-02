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
const tenant = require("../middleware/tenantMiddleware");

router.use(auth, tenant);

router.route("/").get(getMessages).post(createMessage);
router.get("/receiver/:receiverId", getMessagesByReceiver);
router.get("/sender/:senderId", getMessagesBySender);
router.put("/:id/read", markMessageRead);
router.delete("/:id", deleteMessage);

module.exports = router;
