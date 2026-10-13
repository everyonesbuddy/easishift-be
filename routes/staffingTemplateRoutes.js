const express = require("express");
const router = express.Router();
const {
  getTemplate,
  saveTemplate,
} = require("../controllers/staffingTemplateController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant);

router.get("/", requirePermission("coverage.view"), getTemplate);
router.put("/", requirePermission("coverage.manage"), saveTemplate);

module.exports = router;
