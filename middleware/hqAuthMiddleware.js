/**
 * HQ sessions (separate from workspace logins). The token is signed with
 * HQ_JWT_SECRET (falls back to JWT_SECRET) and marked typ "hq"; a workspace
 * token never passes here, and an HQ token never passes workspace auth.
 */
const jwt = require("jsonwebtoken");
const HqUser = require("../models/hqUserModel");

const secret = () => process.env.HQ_JWT_SECRET || process.env.JWT_SECRET;
const SESSION = "12h";

const signHqToken = (hqUser) => jwt.sign({ id: String(hqUser._id), typ: "hq" }, secret(), { expiresIn: SESSION, audience: "wisershifts-hq" });

const hqAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ message: "Sign in to HQ" });
    const decoded = jwt.verify(token, secret(), { audience: "wisershifts-hq" });
    if (decoded.typ !== "hq") return res.status(401).json({ message: "Sign in to HQ" });
    const hqUser = await HqUser.findById(decoded.id).lean();
    if (!hqUser || !hqUser.active) return res.status(401).json({ message: "Sign in to HQ" });
    req.hqUser = hqUser;
    next();
  } catch {
    res.status(401).json({ message: "Sign in to HQ" });
  }
};

module.exports = { hqAuth, signHqToken };
