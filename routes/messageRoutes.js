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
const { requirePermission } = require("../middleware/roleMiddleware");
const tenant = require("../middleware/tenantMiddleware");

router.use(auth, tenant, requireFeature("messaging"));

router
  .route("/")
  .get(getMessages)
  .post(requirePermission("messages.manage"), createMessage);
router.get("/receiver/:receiverId", getMessagesByReceiver);
router.get("/sender/:senderId", getMessagesBySender);
router.put("/:id/read", markMessageRead);
router.delete("/:id", requirePermission("messages.manage"), deleteMessage);

module.exports = router;
