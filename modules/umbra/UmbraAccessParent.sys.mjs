/*
 * JSWindowActor parent side. Reports contain classifications only; no URL,
 * hostname, DOM text, input value, cookie, token or browsing-history field.
 */

import { Services } from "resource://gre/modules/Services.sys.mjs";

export class UmbraAccessParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (message.name !== "Umbra:PageReport") return;
    const data = message.data || {};
    const safe = {
      loginDetected: Boolean(data.loginDetected),
      registrationDetected: Boolean(data.registrationDetected),
      paywallDetected: Boolean(data.paywallDetected),
      checkoutDetected: Boolean(data.checkoutDetected),
      cookieDialogDetected: Boolean(data.cookieDialogDetected),
      paymentProviders: Array.isArray(data.paymentProviders)
        ? data.paymentProviders.slice(0, 8).map(x => String(x).slice(0, 40))
        : [],
      suspiciousIndicators: Array.isArray(data.suspiciousIndicators)
        ? data.suspiciousIndicators.slice(0, 8).map(x => String(x).slice(0, 64))
        : [],
      removedOverlays: Math.max(0, Math.min(100, Number(data.removedOverlays) || 0)),
      isOnion: Boolean(data.isOnion)
    };
    Services.obs.notifyObservers(null, "umbra-access-page-report", JSON.stringify(safe));
  }
}
