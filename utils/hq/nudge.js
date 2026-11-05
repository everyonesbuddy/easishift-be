/** The "your payment didn't go through" email HQ Money sends with a failed invoice's pay link. */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (cents) => `$${(Number(cents || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** The starting subject and message; HQ can edit both before sending. */
function draftNudge({ customer, plan, amountDue, sender, senderEmail }) {
  const what = plan ? `WiserShifts ${String(plan).replace(/^wisershifts\s+/i, "")} payment` : "WiserShifts payment";
  return {
    subject: "Your WiserShifts payment didn't go through",
    message: [
      "Hi,",
      `Your ${what} of ${usd(amountDue)}${customer ? ` for ${customer}` : ""} didn't go through. It's usually an expired card or the bank blocking it.`,
      "You can pay or update your card in a minute with the button below. Your schedules and staff aren't affected.",
      `If you'd rather pay another way or have a question, just email me at ${senderEmail}.`,
      `Thanks,\n${sender || "The WiserShifts team"}`,
    ].join("\n\n"),
  };
}

/** Message text → email HTML, with the pay button after it. */
function nudgeHtml({ message, payUrl, amountDue }) {
  const paras = String(message || "")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#1D1D1F">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const button = `<p style="margin:8px 0 24px"><a href="${esc(payUrl)}" style="display:inline-block;background:#007AFF;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">Pay ${usd(amountDue)} or update card</a></p>`;
  // The button goes after the first two paragraphs (greeting and what happened), the rest follows it.
  const parts = paras.split("</p>").filter(Boolean).map((p) => `${p}</p>`);
  const at = Math.min(3, parts.length);
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px">${parts.slice(0, at).join("")}${button}${parts.slice(at).join("")}<p style="font-size:12px;color:#6E6E73">Or open this link: ${esc(payUrl)}</p></div>`;
}

function nudgeText({ message, payUrl }) {
  return `${message}\n\nPay or update your card: ${payUrl}`;
}

module.exports = { draftNudge, nudgeHtml, nudgeText, usd };
