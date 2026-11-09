/**
 * Texts cost per segment. A text that's all "GSM-7" characters (plain
 * letters, digits, common punctuation) fits 160 characters in one segment;
 * a single other character (–, ·, ’, an emoji) switches the whole text to
 * 70 per segment, roughly doubling the price. So every text is cleaned to
 * GSM-7 before it goes out, and its segments are counted for the logs.
 */
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);
const GSM_EXT = new Set("^{}\\[~]|€".split("")); // count as two

const SWAP = [
  [/[–—−]/g, "-"], // – — −
  [/[·•‧]/g, "-"], // · • ‧
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/…/g, "..."],
  [/[   ]/g, " "],
  [/→/g, "->"],
];

/** Text as GSM-7: common look-alikes swapped, anything else dropped. */
function toGsm(text) {
  let out = String(text ?? "");
  for (const [re, to] of SWAP) out = out.replace(re, to);
  out = out.normalize("NFC");
  // Keep what's GSM-7; otherwise try the letter without its accent (ń → n); otherwise drop it.
  const keep = (c) => GSM_BASIC.has(c) || GSM_EXT.has(c);
  return [...out]
    .map((c) => {
      if (keep(c)) return c;
      const base = c.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      return [...base].every(keep) ? base : "";
    })
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** How many segments a text costs. */
function segments(text) {
  const chars = [...String(text ?? "")];
  const gsm = chars.every((c) => GSM_BASIC.has(c) || GSM_EXT.has(c));
  if (gsm) {
    const len = chars.reduce((n, c) => n + (GSM_EXT.has(c) ? 2 : 1), 0);
    return len <= 160 ? 1 : Math.ceil(len / 153);
  }
  return chars.length <= 70 ? 1 : Math.ceil(chars.length / 67);
}

module.exports = { toGsm, segments };
