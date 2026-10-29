/**
 * HQ command center: WiserShifts' own team only (PLATFORM_ADMIN_EMAILS).
 * Everyone else gets 404, so the area doesn't advertise itself.
 */
const express = require("express");
const multer = require("multer");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const platformAdmin = require("../middleware/platformAdminMiddleware");
const hq = require("../controllers/hqController");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

router.use(auth, platformAdmin);

router.get("/access", hq.getAccess);
router.get("/overview", hq.getOverview);
router.get("/connections", hq.getConnections);

router.get("/plays", hq.getPlays);
router.post("/plays/done", hq.completePlay);

router.get("/facilities", hq.listFacilities);
router.post("/facilities", hq.createFacility);
router.get("/facilities/:id", hq.getFacility);
router.patch("/facilities/:id", hq.updateFacility);

router.get("/contacts", hq.listContacts);
router.post("/contacts", hq.createContact);
router.patch("/contacts/:id", hq.updateContact);

router.get("/activities", hq.listActivities);
router.post("/activities", hq.createActivity);

router.post("/import/:kind", upload.single("file"), hq.importCsv);

router.get("/signups", hq.getSignups);
router.get("/content", hq.getContent);
router.get("/web", hq.getWeb);
router.get("/email", hq.getEmail);
router.post("/sync/klaviyo", hq.syncKlaviyo);

module.exports = router;
