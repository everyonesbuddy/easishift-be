const express = require("express");
const router = express.Router();
const {
  listMembers,
  inviteMember,
  resendInvite,
  updateMember,
  transferOwnership,
  removeMember,
  addStaffProfile,
} = require("../controllers/memberController");
const auth = require("../middleware/authMiddleware");
const tenant = require("../middleware/tenantMiddleware");
const { requirePermission } = require("../middleware/roleMiddleware");

router.use(auth, tenant);

// Anyone with staff.view can see who the members are; only the owner
// (roles.manage) can change them.
const ownerOnly = requirePermission("roles.manage");

router.get("/", requirePermission("staff.view"), listMembers);
router.post("/invite", ownerOnly, inviteMember);
router.post("/:id/resend-invite", ownerOnly, resendInvite);
router.patch("/:id", ownerOnly, updateMember);
router.post("/:id/make-owner", ownerOnly, transferOwnership);
router.delete("/:id", ownerOnly, removeMember);
// "Also put me on the schedule"
router.post("/:id/staff-profile", requirePermission("staff.manage"), addStaffProfile);

module.exports = router;
