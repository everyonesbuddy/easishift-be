/**
 * WiserShifts' own team (the founders), who can open the HQ command center.
 * Not a workspace role: it's set by email in the server's environment.
 *
 * TODO(keys): set PLATFORM_ADMIN_EMAILS on the server (Heroku config vars),
 * comma-separated, e.g. "joseph@wisershifts.com,cofounder@wisershifts.com".
 * Empty = nobody can open HQ.
 */
const adminEmails = () =>
  String(process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const isPlatformAdmin = (user) =>
  Boolean(user?.email) && adminEmails().includes(String(user.email).trim().toLowerCase());

module.exports = { isPlatformAdmin, adminEmails };
