/** HQ sign-in (WiserShifts' own team; separate from workspace accounts). */
const bcrypt = require("bcryptjs");
const HqUser = require("../models/hqUserModel");
const { signHqToken } = require("../middleware/hqAuthMiddleware");

const LOCK_AFTER = 8;
const LOCK_MINUTES = 30;
const pub = (u) => ({ _id: u._id, email: u.email, name: u.name, lastLoginAt: u.lastLoginAt });

exports.login = async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const fail = () => res.status(401).json({ message: "Wrong email or password" });
    if (!email || !password) return fail();
    const user = await HqUser.findOne({ email }).select("+passwordHash");
    if (!user || !user.active) return fail();
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return res.status(429).json({ message: "Too many tries. Wait 30 minutes and try again." });
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      user.failedLogins += 1;
      if (user.failedLogins >= LOCK_AFTER) {
        user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
        user.failedLogins = 0;
      }
      await user.save();
      return fail();
    }
    user.failedLogins = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: signHqToken(user), user: pub(user) });
  } catch (err) {
    next(err);
  }
};

exports.me = (req, res) => res.json({ user: pub(req.hqUser) });

exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword = "", newPassword = "" } = req.body || {};
    if (String(newPassword).length < 12) return res.status(400).json({ message: "Use at least 12 characters" });
    const user = await HqUser.findById(req.hqUser._id).select("+passwordHash");
    if (!(await bcrypt.compare(String(currentPassword), user.passwordHash))) {
      return res.status(400).json({ message: "Current password is wrong" });
    }
    user.passwordHash = await bcrypt.hash(String(newPassword), 12);
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
