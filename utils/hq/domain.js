/** HQ: the company domain from a website or email, ignoring free email providers. */
const FREEMAIL = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "live.com",
  "msn.com", "me.com", "comcast.net", "att.net", "verizon.net", "sbcglobal.net", "bellsouth.net",
  "ymail.com", "protonmail.com", "proton.me", "mail.com", "gmx.com", "charter.net", "cox.net",
]);

const domainOf = (value = "") => {
  let s = String(value || "").trim().toLowerCase();
  if (!s) return "";
  // =HYPERLINK("https://x.com","x.com") from spreadsheets
  const link = s.match(/hyperlink\(\s*"([^"]+)"/i);
  if (link) s = link[1];
  if (s.includes("@") && !s.includes("/")) s = s.split("@").pop();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:\s]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return "";
  return FREEMAIL.has(s) ? "" : s;
};

const isFreemail = (email = "") => FREEMAIL.has(String(email).split("@").pop().toLowerCase());

module.exports = { domainOf, isFreemail, FREEMAIL };
