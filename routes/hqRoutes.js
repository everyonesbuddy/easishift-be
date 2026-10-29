/**
 * HQ command center: WiserShifts' own team only. HQ has its own accounts and
 * sign-in (HqUser), separate from every workspace; workspace logins can't
 * open anything here.
 */
const express = require("express");
const multer = require("multer");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { hqAuth } = require("../middleware/hqAuthMiddleware");
const hq = require("../controllers/hqController");
const hqAuthController = require("../controllers/hqAuthController");
const sheets = require("../controllers/hqSheetsController");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

// Sign-in (public, limited per visitor; accounts also lock after 8 wrong tries).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many tries. Wait a few minutes and try again." },
});
router.post("/auth/login", loginLimiter, hqAuthController.login);

router.use(hqAuth);
router.get("/auth/me", hqAuthController.me);
router.post("/auth/change-password", hqAuthController.changePassword);

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

router.get("/sheets", sheets.getSheets);
router.post("/sheets/tabs", sheets.listTabs);
router.put("/sheets", sheets.saveSheets);
router.post("/sheets/sync", sheets.syncSheets);

router.get("/signups", hq.getSignups);
router.get("/content", hq.getContent);
router.get("/web", hq.getWeb);
router.get("/email", hq.getEmail);
router.post("/sync/klaviyo", hq.syncKlaviyo);

module.exports = router;
