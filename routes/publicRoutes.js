const express = require("express");
const router = express.Router();
const {
  getTenantBranding,
  getTenantLogo,
  checkSubdomainAvailability,
} = require("../controllers/publicTenantController");

router.get("/tenant-branding", getTenantBranding);
router.get("/tenants/:tenantId/logo", getTenantLogo);
router.get("/subdomain-availability", checkSubdomainAvailability);

module.exports = router;
