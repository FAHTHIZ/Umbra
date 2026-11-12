/*
 * Umbra Access Engine — local rule primitives.
 *
 * These rules are intentionally small starter data, not a replacement for
 * EasyList/EasyPrivacy. No remote list fetches occur here. Third-party rule
 * lists must be vendored with license/attribution records and updated through
 * an explicit, integrity-checked browser update path.
 */

export const RULESET_VERSION = "0.1.0";

const AD_HOSTS = new Set([
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "adnxs.com",
  "taboola.com",
  "outbrain.com",
  "criteo.com",
  "pubmatic.com",
  "openx.net",
  "rubiconproject.com",
  "adsrvr.org",
  "scorecardresearch.com"
]);

const TRACKER_HOSTS = new Set([
  "google-analytics.com",
  "analytics.google.com",
  "googletagmanager.com",
  "connect.facebook.net",
  "facebook.com",
  "hotjar.com",
  "clarity.ms",
  "segment.io",
  "segment.com",
  "amplitude.com",
  "mixpanel.com",
  "newrelic.com",
  "fullstory.com"
]);

const PAYMENT_PROVIDERS = new Map([
  ["stripe.com", "Stripe"],
  ["paypal.com", "PayPal"],
  ["braintreepayments.com", "Braintree"],
  ["adyen.com", "Adyen"],
  ["checkout.com", "Checkout.com"],
  ["squareup.com", "Square"],
  ["authorize.net", "Authorize.Net"],
  ["2checkout.com", "2Checkout"],
  ["razorpay.com", "Razorpay"],
  ["paystack.com", "Paystack"],
  ["paddle.com", "Paddle"],
  ["lemonsqueezy.com", "Lemon Squeezy"]
]);

const SAFE_RESOURCE_TYPES = new Set([
  "script", "image", "stylesheet", "object", "subdocument", "xmlhttprequest",
  "websocket", "font", "media", "other"
]);

function normalizeHost(hostname) {
  return String(hostname || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function isOnionHostname(hostname) {
  const host = normalizeHost(hostname);
  return host.endsWith(".onion");
}

export function isValidV3OnionHostname(hostname) {
  const host = normalizeHost(hostname);
  const label = host.endsWith(".onion") ? host.slice(0, -6) : "";
  return /^[a-z2-7]{56}$/.test(label);
}

export function hostMatchesDomain(hostname, domain) {
  const host = normalizeHost(hostname);
  const candidate = normalizeHost(domain);
  return Boolean(host && candidate && (host === candidate || host.endsWith("." + candidate)));
}

export function isKnownAdHost(hostname) {
  return [...AD_HOSTS].some(domain => hostMatchesDomain(hostname, domain));
}

export function isKnownTrackerHost(hostname) {
  return [...TRACKER_HOSTS].some(domain => hostMatchesDomain(hostname, domain));
}

export function paymentProviderForHost(hostname) {
  for (const [domain, provider] of PAYMENT_PROVIDERS) {
    if (hostMatchesDomain(hostname, domain)) return provider;
  }
  return null;
}

/**
 * Decide only from the request hostname and resource type. This function does
 * not perform DNS, HTTP, telemetry, or any other network operation.
 */
export function classifyRequest({ hostname, resourceType = "other", firstPartyHost = "" } = {}) {
  const host = normalizeHost(hostname);
  const firstParty = normalizeHost(firstPartyHost);
  const type = String(resourceType || "other").toLowerCase();

  if (!host || !SAFE_RESOURCE_TYPES.has(type)) {
    return { action: "allow", reason: "unknown-request-metadata" };
  }

  // Never send an onion hostname to an external rules service. All decisions
  // here are local. Keep same-origin requests untouched.
  if (firstParty && hostMatchesDomain(host, firstParty)) {
    return { action: "allow", reason: "first-party" };
  }

  if (isKnownAdHost(host)) {
    return { action: "block", reason: "known-ad-domain" };
  }

  if (isKnownTrackerHost(host) && type !== "document") {
    return { action: "block", reason: "known-tracker-domain" };
  }

  return { action: "allow", reason: "no-local-rule-match" };
}

export function getRuleSummary() {
  return Object.freeze({
    version: RULESET_VERSION,
    adDomainCount: AD_HOSTS.size,
    trackerDomainCount: TRACKER_HOSTS.size,
    paymentProviderCount: PAYMENT_PROVIDERS.size,
    remoteListsEnabled: false
  });
}
