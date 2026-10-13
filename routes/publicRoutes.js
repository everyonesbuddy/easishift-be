const express = require("express");
const router = express.Router();
const { getTenantLogo } = require("../controllers/publicTenantController");

router.get("/tenants/:tenantId/logo", getTenantLogo);

module.exports = router;
