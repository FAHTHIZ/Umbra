/*
 * Runs inside the content process for ordinary HTTP(S) documents.
 * It inspects only DOM structure and field metadata. It never reads form values,
 * cookies, local storage, page text wholesale, or credential/payment contents.
 * The top frame inspects script/iframe/form destinations; no onion URL is sent
 * to any service or included in the parent-process report.
 */

(function () {
  "use strict";

  const { paymentProviderForHost, isOnionHostname } =
    ChromeUtils.importESModule("resource:///modules/umbra/FilterRules.sys.mjs");

  let settings = { enabled: true, cosmetic: true };
  let scheduled = false;
  let observer = null;
  let styleInstalled = false;

  addMessageListener("Umbra:Settings", message => {
    settings = {
      enabled: Boolean(message.data && message.data.enabled),
      cosmetic: Boolean(message.data && message.data.cosmetic)
    };
    if (settings.enabled && settings.cosmetic) {
      scheduleScan();
    }
  });

  function isSensitiveElement(element) {
    if (!element || !element.querySelector) {
      return true;
    }
    return Boolean(element.querySelector(
      'input[type="password"], input[autocomplete^="cc-"], input[name*="cardnumber" i], form[action*="checkout" i]'
    ));
  }

  function installCosmeticStyle(doc) {
    if (styleInstalled || !settings.enabled || !settings.cosmetic) {
      return;
    }
    const style = doc.createElement("style");
    style.id = "umbra-access-cosmetic-style";
    style.textContent =
      '.adsbygoogle, [data-ad-slot], [data-advertisement], ' +
      '[aria-label="Advertisement"], [aria-label="Sponsored advertisement"], ' +
      'iframe[src*="doubleclick.net"], iframe[src*="googlesyndication.com"]' +
      ' { display: none !important; visibility: hidden !important; }';
    (doc.documentElement || doc.head || doc.body).appendChild(style);
    styleInstalled = true;
  }

  function hideKnownPromotionalOverlays(doc) {
    if (!settings.enabled || !settings.cosmetic || !doc.body) {
      return 0;
    }
    const selector =
      '[id*="newsletter-modal" i], [class*="newsletter-modal" i], ' +
      '[id*="promo-overlay" i], [class*="promo-overlay" i], ' +
      '[id*="promotion-modal" i], [class*="promotion-modal" i]';
    let removed = 0;
    for (const element of Array.from(doc.querySelectorAll(selector)).slice(0, 30)) {
      if (element.hasAttribute("data-umbra-hidden") || isSensitiveElement(element)) {
        continue;
      }
      const style = doc.defaultView.getComputedStyle(element);
      if (style.position !== "fixed" && !element.matches("dialog[open]")) {
        continue;
      }
      const zIndex = Number.parseInt(style.zIndex, 10);
      if (style.position === "fixed" && Number.isFinite(zIndex) && zIndex < 10) {
        continue;
      }
      element.setAttribute("data-umbra-hidden", "promotion");
      element.hidden = true;
      removed += 1;
    }
    return removed;
  }

  function detectCookieDialog(doc) {
    return Boolean(doc.querySelector(
      '#onetrust-banner-sdk, #onetrust-consent-sdk, .cky-consent-container, ' +
      '.cc-window, [id*="cookie-consent" i], [class*="cookie-consent" i], ' +
      '[aria-label*="cookie" i][role="dialog"]'
    ));
  }

  function detectPaywall(doc) {
    return Boolean(doc.querySelector(
      '[class*="paywall" i], [id*="paywall" i], [data-testid*="paywall" i], ' +
      '.meteredContent, [class*="subscription-wall" i], [data-paywall]'
    ));
  }

  function detectAuthentication(doc) {
    const forms = Array.from(doc.querySelectorAll("form")).slice(0, 60);
    let loginDetected = false;
    let registrationDetected = false;
    for (const form of forms) {
      const password = Boolean(form.querySelector('input[type="password"]'));
      if (!password) {
        continue;
      }
      loginDetected = true;
      if (form.querySelector('input[type="email"], input[autocomplete="email"]')) {
        registrationDetected = true;
      }
    }
    return { loginDetected, registrationDetected };
  }

  function paymentAndCheckout(doc) {
    const providers = new Set();
    const elements = Array.from(doc.querySelectorAll("script[src], iframe[src], form[action]")).slice(0, 120);
    for (const element of elements) {
      const attribute = element.matches("form") ? "action" : "src";
      const raw = element.getAttribute(attribute);
      if (!raw) {
        continue;
      }
      try {
        const parsed = new URL(raw, doc.location.href);
        const provider = paymentProviderForHost(parsed.hostname);
        if (provider) {
          providers.add(provider);
        }
      } catch (_) {}
    }

    const cardFieldSelector =
      'input[autocomplete*="cc-number" i], input[autocomplete*="cc-exp" i], ' +
      'input[name*="card-number" i], input[name*="cardnumber" i]';
    const cardField = doc.querySelector(cardFieldSelector);
    const actionWarnings = new Set();
    const forms = Array.from(doc.querySelectorAll("form[action]")).slice(0, 60);
    for (const form of forms) {
      if (!form.querySelector(cardFieldSelector)) {
        continue;
      }
      try {
        const action = new URL(form.getAttribute("action"), doc.location.href);
        const current = new URL(doc.location.href);
        const actionIsOnion = isOnionHostname(action.hostname);
        if (action.protocol === "http:" && !actionIsOnion) {
          actionWarnings.add("insecure-payment-action");
        }
        if (action.origin !== current.origin && !paymentProviderForHost(action.hostname)) {
          actionWarnings.add("unrecognized-payment-destination");
        }
      } catch (_) {
        actionWarnings.add("invalid-payment-destination");
      }
    }

    const actionLabels = Array.from(doc.querySelectorAll(
      'button, [role="button"], input[type="submit"], h1, h2'
    )).slice(0, 40).map(element => {
      if (element.matches('input[type="submit"]')) {
        return element.getAttribute("value") || "";
      }
      return element.getAttribute("aria-label") || element.textContent || "";
    }).join(" ").toLowerCase().slice(0, 2500);

    const checkoutDetected = Boolean(
      cardField ||
      /\b(checkout|place order|pay now|payment details|complete purchase)\b/.test(actionLabels)
    );
    return {
      checkoutDetected,
      paymentProviders: Array.from(providers),
      suspiciousIndicators: Array.from(actionWarnings)
    };
  }

  function scan() {
    scheduled = false;
    const doc = content.document;
    if (!doc || !/^https?:$/.test(doc.location.protocol) || content !== content.top) {
      return;
    }

    if (settings.enabled && settings.cosmetic) {
      installCosmeticStyle(doc);
    }
    const removedOverlays = hideKnownPromotionalOverlays(doc);
    const auth = detectAuthentication(doc);
    const payment = paymentAndCheckout(doc);
    const report = {
      type: "page-report",
      report: {
        loginDetected: auth.loginDetected,
        registrationDetected: auth.registrationDetected,
        paywallDetected: detectPaywall(doc),
        checkoutDetected: payment.checkoutDetected,
        cookieDialogDetected: detectCookieDialog(doc),
        paymentProviders: payment.paymentProviders,
        suspiciousIndicators: payment.suspiciousIndicators,
        removedOverlays,
        isOnion: isOnionHostname(doc.location.hostname)
      }
    };
    sendAsyncMessage("Umbra:PageReport", report);
  }

  function scheduleScan() {
    if (scheduled) {
      return;
    }
    scheduled = true;
    content.setTimeout(scan, 250);
  }

  addEventListener("DOMContentLoaded", () => {
    scheduleScan();
    const doc = content.document;
    if (doc && doc.body && !observer) {
      observer = new content.MutationObserver(scheduleScan);
      observer.observe(doc.body, { childList: true, subtree: true });
    }
  }, true);

  addEventListener("pageshow", scheduleScan, true);
})();