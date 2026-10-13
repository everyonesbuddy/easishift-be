const express = require("express");
const multer = require("multer");
const router = express.Router();
const {
  listStaff,
  getStaff,
  createStaff,
  bulkCreateStaff,
  importStaffCsv,
  updateStaff,
  archiveStaff,
  restoreStaff,
  deleteStaff,
  getStaffLink,
  sendStaffLink,
  rotateStaffLink,
} = require("../controllers/staffController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");
const { requireFeature } = require("../middleware/planMiddleware");

const csvUpload = (req, res, next) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter(_req, file, cb) {
      const ok =
        ["text/csv", "application/vnd.ms-excel", "text/plain"].includes(
          file.mimetype,
        ) || file.originalname.toLowerCase().endsWith(".csv");
      cb(ok ? null : new Error("Only .csv files are accepted"), ok);
    },
  }).single("file")(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({ message: err.message || "Invalid upload" });
  });

router.use(auth, tenant);

const canView = requirePermission("staff.view");
const canManage = requirePermission("staff.manage");

router.get("/", canView, listStaff);
router.post("/", canManage, createStaff);
router.post("/bulk", canManage, bulkCreateStaff);
router.post("/import", canManage, requireFeature("import"), csvUpload, importStaffCsv);
router.get("/:id", canView, getStaff);
router.patch("/:id", canManage, updateStaff);
router.post("/:id/archive", canManage, archiveStaff);
router.post("/:id/restore", canManage, restoreStaff);
router.delete("/:id", canManage, deleteStaff);
router.get("/:id/link", canManage, getStaffLink);
router.post("/:id/send-link", canManage, sendStaffLink);
router.post("/:id/rotate-link", canManage, rotateStaffLink);

module.exports = router;
