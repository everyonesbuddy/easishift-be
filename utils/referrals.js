/**
 * Referral codes: the partner's Stripe promotion code (e.g. "SAFEHANDS"),
 * given at signup (typed, or from ?code= in the link) or typed at checkout.
 */

/** "safe hands" → "SAFEHANDS". Letters, digits, - and _ only, up to 30. */
function cleanCode(v) {
  const s = String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 30);
  return s || null;
}

/** The active Stripe promotion code with this code, or null. Never throws. */
async function findPromotionCode(stripe, code) {
  const c = cleanCode(code);
  if (!stripe || !c) return null;
  try {
    const { data } = await stripe.promotionCodes.list({ code: c, active: true, limit: 1 });
    return data?.[0] || null;
  } catch {
    return null;
  }
}

/** The promotion code a subscription was started with ("SAFEHANDS"), or null. Never throws. */
async function codeOnSubscription(stripe, subscriptionId) {
  if (!stripe || !subscriptionId) return null;
  try {
    const sub = await stripe.subscriptions
      .retrieve(subscriptionId, { expand: ["discounts"] })
      .catch(() => stripe.subscriptions.retrieve(subscriptionId));
    const discounts = [sub?.discount, ...(Array.isArray(sub?.discounts) ? sub.discounts : [])].filter((d) => d && typeof d === "object");
    for (const d of discounts) {
      const promo = d.promotion_code;
      if (!promo) continue;
      if (typeof promo === "object" && promo.code) return cleanCode(promo.code);
      const p = await stripe.promotionCodes.retrieve(promo);
      if (p?.code) return cleanCode(p.code);
    }
  } catch {
    // A missing code never blocks a subscription.
  }
  return null;
}

/** Short words for a Stripe coupon: "100% off for 1 month", "$50 off once". */
function couponWords(coupon) {
  if (!coupon) return "";
  const off = coupon.percent_off ? `${coupon.percent_off}% off` : coupon.amount_off ? `$${(coupon.amount_off / 100).toFixed(0)} off` : "a discount";
  if (coupon.duration === "forever") return `${off} forever`;
  if (coupon.duration === "repeating") return `${off} for ${coupon.duration_in_months} month${coupon.duration_in_months === 1 ? "" : "s"}`;
  return `${off} once`;
}

module.exports = { cleanCode, findPromotionCode, codeOnSubscription, couponWords };
