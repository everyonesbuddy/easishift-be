const express = require("express");
const router = express.Router();

const { parseForm } = require("../controllers/nlParseController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");

router.use(auth);
router.use(tenant);

router.post("/parse", parseForm);

module.exports = router;
