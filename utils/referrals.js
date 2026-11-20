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

/**
 * How a partner's code is used at checkout (pure; tested).
 *
 * The partner coupon is "100% off for 1 month". On a monthly plan that's
 * the first month free. On a yearly plan it would make the whole first
 * year free (the first invoice is the year), so a yearly plan gets the
 * free month as 30 extra trial days instead, and Stripe's code box is
 * off for yearly plans so a partner code can't be typed there either.
 *
 * Returns the checkout params for codes, the trial days, and metadata
 * (referral: the code, when it was turned into trial days).
 */
const EXTRA_TRIAL_DAYS = 30;
function checkoutCodeOptions({ interval, promo, code, trialDays = 0 }) {
  if (interval === "year") {
    if (promo && code) return { params: {}, trialDays: trialDays + EXTRA_TRIAL_DAYS, metadata: { referral: code } };
    return { params: {}, trialDays, metadata: {} };
  }
  if (promo) return { params: { discounts: [{ promotion_code: promo.id }] }, trialDays, metadata: {} };
  return { params: { allow_promotion_codes: true }, trialDays, metadata: {} };
}

/** Short words for a Stripe coupon: "100% off for 1 month", "$50 off once". */
function couponWords(coupon) {
  if (!coupon) return "";
  const off = coupon.percent_off ? `${coupon.percent_off}% off` : coupon.amount_off ? `$${(coupon.amount_off / 100).toFixed(0)} off` : "a discount";
  if (coupon.duration === "forever") return `${off} forever`;
  if (coupon.duration === "repeating") return `${off} for ${coupon.duration_in_months} month${coupon.duration_in_months === 1 ? "" : "s"}`;
  return `${off} once`;
}

module.exports = { cleanCode, findPromotionCode, codeOnSubscription, checkoutCodeOptions, couponWords, EXTRA_TRIAL_DAYS };
