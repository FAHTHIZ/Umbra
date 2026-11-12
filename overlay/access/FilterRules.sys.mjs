/*
 * Umbra Access Engine starter rules.
 *
 * These are a small, hand-maintained starter set, not a copy of EasyList or
 * EasyPrivacy and not a complete filter-list parser. Rule matches are local.
 * Never add a rule that blocks a top-level navigation.
 */

export const HOST_RULES = Object.freeze([
  { domain: "doubleclick.net", category: "ads", reason: "ad delivery" },
  { domain: "googlesyndication.com", category: "ads", reason: "ad delivery" },
  { domain: "googleadservices.com", category: "ads", reason: "ad delivery" },
  { domain: "adnxs.com", category: "ads", reason: "ad exchange" },
  { domain: "adsrvr.org", category: "ads", reason: "ad exchange" },
  { domain: "taboola.com", category: "ads", reason: "recommendation advertising" },
  { domain: "outbrain.com", category: "ads", reason: "recommendation advertising" },
  { domain: "criteo.com", category: "ads", reason: "ad delivery" },
  { domain: "adform.net", category: "ads", reason: "ad delivery" },
  { domain: "google-analytics.com", category: "trackers", reason: "analytics" },
  { domain: "analytics.google.com", category: "trackers", reason: "analytics" },
  { domain: "scorecardresearch.com", category: "trackers", reason: "audience measurement" },
  { domain: "hotjar.com", category: "trackers", reason: "session analytics" },
  { domain: "segment.io", category: "trackers", reason: "analytics collection" },
  { domain: "mixpanel.com", category: "trackers", reason: "analytics collection" },
  { domain: "clarity.ms", category: "trackers", reason: "session analytics" }
]);

export const PAYMENT_PROVIDERS = Object.freeze([
  { name: "Stripe", domains: ["stripe.com", "stripe.network"] },
  { name: "PayPal", domains: ["paypal.com", "paypalobjects.com"] },
  { name: "Adyen", domains: ["adyen.com", "adyenpayments.com"] },
  { name: "Braintree", domains: ["braintreegateway.com", "braintreepayments.com"] },
  { name: "Square", domains: ["squareup.com", "square.site"] },
  { name: "Paddle", domains: ["paddle.com", "paddlecdn.com"] },
  { name: "Lemon Squeezy", domains: ["lemonsqueezy.com"] },
  { name: "Shopify", domains: ["shopify.com", "shop.app"] }
]);

export function normalizeHostname(hostname) {
  return String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
}

export function isOnionHostname(hostname) {
  const host = normalizeHostname(hostname);
  // v3 onion service hostnames use one 56-character base32 label. This checks\n  // syntax only; it does not verify the address checksum/public-key relation.\n  return /^[a-z2-7]{56}\\.onion$/.test(host);
}

export function hostMatches(hostname, ruleDomain) {
  const host = normalizeHostname(hostname);
  const rule = normalizeHostname(ruleDomain);
  return Boolean(host && rule && (host === rule || host.endsWith("." + rule)));
}

export function findHostRule(hostname, rules = HOST_RULES) {
  return rules.find(rule => hostMatches(hostname, rule.domain)) || null;
}

export function paymentProviderForHost(hostname) {
  const provider = PAYMENT_PROVIDERS.find(item =>
    item.domains.some(domain => hostMatches(hostname, domain))
  );
  return provider ? provider.name : null;
}
