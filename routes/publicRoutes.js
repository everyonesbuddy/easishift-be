const express = require("express");
const router = express.Router();
const { getTenantLogo } = require("../controllers/publicTenantController");
const blog = require("../controllers/blogController");

router.get("/tenants/:tenantId/logo", getTenantLogo);
router.get("/blog", blog.listPosts);
router.get("/blog/:slug", blog.getPost);

module.exports = router;
