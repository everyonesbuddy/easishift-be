const { isPlatformAdmin } = require("../config/platformAdmin");

/** After auth: only WiserShifts' own team gets through (404 for everyone else). */
module.exports = (req, res, next) => {
  if (!isPlatformAdmin(req.user)) return res.status(404).json({ message: "Not found" });
  next();
};
