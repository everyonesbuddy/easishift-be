/**
 * Signup bot checks (workspace signup is public and sends a welcome email,
 * so bots use it to fill our database and mail strangers).
 *
 * - honeypot: the website's form has a hidden "website" field people never
 *   see; anything in it is a bot.
 * - too fast: the website sends when the form was opened; a human can't fill
 *   four fields and a password in under 2 seconds.
 * - gibberish names: bots type random mixed-case strings
 *   ("HuUdlfYLqgJilqaFoDcufSp"). Real names have spaces or few case changes.
 *
 * The app's signup sends neither field, so those two checks only apply when
 * the fields are present. The rate limit (routes) covers everything.
 */

const MIN_FILL_MS = 2000;

/** One long word that flips from lower to upper case three or more times. */
function looksLikeGibberish(value) {
  const s = String(value || "").trim();
  if (s.length < 10 || /\s/.test(s)) return false;
  if (!/^[A-Za-z]+$/.test(s)) return false;
  const flips = (s.match(/[a-z][A-Z]/g) || []).length;
  return flips >= 3;
}

/**
 * { ok: true } or { ok: false, reason, message } — reason is for logs,
 * message is what the person sees (kept vague for bots).
 */
function checkSignup(body = {}, now = Date.now()) {
  if (body.website !== undefined && String(body.website).trim() !== "") {
    return { ok: false, reason: "honeypot", message: "Couldn't create your account. Try again." };
  }
  const started = Number(body.formStartedAt);
  if (Number.isFinite(started) && started > 0) {
    const took = now - started;
    if (took >= 0 && took < MIN_FILL_MS) {
      return { ok: false, reason: "too_fast", message: "Couldn't create your account. Try again." };
    }
  }
  const names = [body.name, body.facilityName, body.adminName];
  if (names.some(looksLikeGibberish)) {
    return {
      ok: false,
      reason: "gibberish_name",
      message: "Please use your real name and your facility's name.",
    };
  }
  return { ok: true };
}

module.exports = { checkSignup, looksLikeGibberish, MIN_FILL_MS };
