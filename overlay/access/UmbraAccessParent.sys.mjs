/*
 * Parent-side report sanitizer for the Umbra JSWindowActor.
 * The content process is untrusted. This module forwards only a fixed schema
 * of bounded classifications; it never forwards a URL or browsing identifier.
 */

import { Services } from "resource://gre/modules/Services.sys.mjs";

const ALLOWED_PROVIDERS = new Set([
  "Stripe", "PayPal", "Adyen", "Braintree", "Square", "Paddle",
  "Lemon Squeezy", "Shopify"
]);
const ALLOWED_INDICATORS = new Set([
  "insecure-payment-action",
  "unrecognized-payment-destination",
  "invalid-payment-destination"
]);

export class UmbraAccessParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (message.name !== "Umbra:PageReport") {
      return;
    }
    const data = message.data || {};
    const safe = {
      loginDetected: Boolean(data.loginDetected),
      registrationDetected: Boolean(data.registrationDetected),
      paywallDetected: Boolean(data.paywallDetected),
      checkoutDetected: Boolean(data.checkoutDetected),
      cookieDialogDetected: Boolean(data.cookieDialogDetected),
      paymentProviders: Array.isArray(data.paymentProviders)
        ? data.paymentProviders.filter(x => ALLOWED_PROVIDERS.has(x)).slice(0, 8)
        : [],
      suspiciousIndicators: Array.isArray(data.suspiciousIndicators)
        ? data.suspiciousIndicators.filter(x => ALLOWED_INDICATORS.has(x)).slice(0, 8)
        : [],
      removedOverlays: Math.max(0, Math.min(50, Number(data.removedOverlays) || 0)),
      isOnion: Boolean(data.isOnion)
    };

    Services.obs.notifyObservers(
      null,
      "umbra-access-page-report",
      JSON.stringify(safe)
    );
  }
}
