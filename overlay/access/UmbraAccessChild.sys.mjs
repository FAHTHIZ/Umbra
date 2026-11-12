/*
 * Umbra DOM inspector — JSWindowActor child.
 *
 * It runs only in the top-level HTTP(S) document. It reads DOM structure and
 * form metadata, never field values, cookies, local/session storage, full page
 * text, credentials, tokens, or payment data. Reports contain classifications
 * only and are delivered to the parent process over the browser IPC channel.
 */

import { Services } from "resource://gre/modules/Services.sys.mjs";
import {
  isOnionHostname,
  paymentProviderForHost
} from "resource:///modules/umbra/FilterRules.sys.mjs";

const MAX_FORMS = 60;
const MAX_REMOTE_ELEMENTS = 120;
const MAX_LABEL_ELEMENTS = 40;

function pref(name, fallback = true) {
  try {
    return Services.prefs.getBoolPref(name, fallback);
  } catch (_) {
    return fallback;
  }
}

function safeUrl(raw, base) {
  try {
    return new URL(raw, base);
  } catch (_) {
    return null;
  }
}

export class UmbraAccessChild extends JSWindowActorChild {
  constructor() {
    super();
    this._observer = null;
    this._scheduled = false;
    this._styleInstalled = false;
    this._timer = null;
  }

  handleEvent(event) {
    if (event.type === "DOMContentLoaded") {
      this._attachObserver();
      this._scheduleScan();
    } else if (event.type === "pageshow") {
      this._scheduleScan();
    }
  }

  didDestroy() {
    try {
      this._observer?.disconnect();
      if (this._timer !== null) {
        this.contentWindow?.clearTimeout(this._timer);
      }
    } catch (_) {}
    this._observer = null;
    this._timer = null;
  }

  _attachObserver() {
    const win = this.contentWindow;
    const doc = win?.document;
    if (!doc?.body || this._observer || win !== win.top) {
      return;
    }

    this._observer = new win.MutationObserver(() => this._scheduleScan());
    this._observer.observe(doc.body, { childList: true, subtree: true });
  }

  _scheduleScan() {
    const win = this.contentWindow;
    if (!win || this._scheduled) {
      return;
    }
    this._scheduled = true;
    this._timer = win.setTimeout(() => {
      this._scheduled = false;
      this._timer = null;
      this._scan();
    }, 300);
  }

  _restoreCosmetics(doc) {
    const style = doc.getElementById("umbra-access-cosmetic-style");
    style?.remove();
    for (const element of doc.querySelectorAll("[data-umbra-hidden='promotion']")) {
      element.hidden = false;
      element.removeAttribute("data-umbra-hidden");
    }
    this._styleInstalled = false;
  }

  _installCosmeticStyle(doc) {
    if (this._styleInstalled || doc.getElementById("umbra-access-cosmetic-style")) {
      this._styleInstalled = true;
      return;
    }
    const style = doc.createElement("style");
    style.id = "umbra-access-cosmetic-style";
    style.textContent =
      ".adsbygoogle, [data-ad-slot], [data-advertisement], " +
      "[aria-label='Advertisement'], [aria-label='Sponsored advertisement'], " +
      "iframe[src*='doubleclick.net'], iframe[src*='googlesyndication.com']" +
      " { display:none !important; visibility:hidden !important; }";
    (doc.head || doc.documentElement).appendChild(style);
    this._styleInstalled = true;
  }

  _hidePromotionalOverlays(doc) {
    const selector =
      "[id*='newsletter-modal' i], [class*='newsletter-modal' i], " +
      "[id*='promo-overlay' i], [class*='promo-overlay' i], " +
      "[id*='promotion-modal' i], [class*='promotion-modal' i]";
    let hidden = 0;

    for (const element of Array.from(doc.querySelectorAll(selector)).slice(0, 30)) {
      if (element.hasAttribute("data-umbra-hidden") || !element.querySelector) {
        continue;
      }

      // Never dismiss an element containing sign-in, payment, or checkout controls.
      if (element.querySelector(
        "input[type='password'], input[autocomplete^='cc-'], " +
        "input[name*='cardnumber' i], form[action*='checkout' i]"
      )) {
        continue;
      }

      const style = doc.defaultView.getComputedStyle(element);
      const z = Number.parseInt(style.zIndex, 10);
      const looksModal = element.matches("dialog[open]") ||
        (style.position === "fixed" && (!Number.isFinite(z) || z >= 10));
      if (!looksModal) {
        continue;
      }

      element.setAttribute("data-umbra-hidden", "promotion");
      element.hidden = true;
      hidden += 1;
    }
    return hidden;
  }

  _detectCookieDialog(doc) {
    return Boolean(doc.querySelector(
      "#onetrust-banner-sdk, #onetrust-consent-sdk, .cky-consent-container, " +
      ".cc-window, [id*='cookie-consent' i], [class*='cookie-consent' i], " +
      "[aria-label*='cookie' i][role='dialog']"
    ));
  }

  _detectPaywall(doc) {
    return Boolean(doc.querySelector(
      "[class*='paywall' i], [id*='paywall' i], [data-testid*='paywall' i], " +
      ".meteredContent, [class*='subscription-wall' i], [data-paywall]"
    ));
  }

  _detectAuthentication(doc) {
    const forms = Array.from(doc.querySelectorAll("form")).slice(0, MAX_FORMS);
    let loginDetected = false;
    let registrationDetected = false;

    for (const form of forms) {
      if (!form.querySelector("input[type='password']")) {
        continue;
      }
      loginDetected = true;
      const text = [
        form.getAttribute("action") || "",
        form.getAttribute("aria-label") || "",
        form.getAttribute("name") || ""
      ].join(" ").toLowerCase();

      const fields = form.querySelectorAll("input").length;
      const hasConfirmation = Boolean(form.querySelector(
        "input[autocomplete='new-password'], input[name*='confirm' i]"
      ));
      if (hasConfirmation || fields >= 4 || /register|sign.?up|create.?account/.test(text)) {
        registrationDetected = true;
      }
    }
    return { loginDetected, registrationDetected };
  }

  _inspectPayment(doc) {
    const providers = new Set();
    const warnings = new Set();
    const remoteElements = Array.from(
      doc.querySelectorAll("script[src], iframe[src], form[action]")
    ).slice(0, MAX_REMOTE_ELEMENTS);

    for (const element of remoteElements) {
      const attr = element.matches("form") ? "action" : "src";
      const raw = element.getAttribute(attr);
      const parsed = raw ? safeUrl(raw, doc.location.href) : null;
      if (!parsed) {
        continue;
      }
      const provider = paymentProviderForHost(parsed.hostname);
      if (provider) {
        providers.add(provider);
      }
    }

    const cardSelector =
      "input[autocomplete*='cc-number' i], input[autocomplete*='cc-exp' i], " +
      "input[name*='card-number' i], input[name*='cardnumber' i]";
    const forms = Array.from(doc.querySelectorAll("form[action]")).slice(0, MAX_FORMS);
    for (const form of forms) {
      if (!form.querySelector(cardSelector)) {
        continue;
      }
      const action = safeUrl(form.getAttribute("action"), doc.location.href);
      const current = safeUrl(doc.location.href, doc.location.href);
      if (!action || !current) {
        warnings.add("invalid-payment-destination");
        continue;
      }

      const onionAction = isOnionHostname(action.hostname);
      if (action.protocol === "http:" && !onionAction) {
        warnings.add("insecure-payment-action");
      }
      if (action.origin !== current.origin && !paymentProviderForHost(action.hostname)) {
        warnings.add("unrecognized-payment-destination");
      }
    }

    const labels = Array.from(doc.querySelectorAll(
      "button, [role='button'], input[type='submit'], h1, h2"
    )).slice(0, MAX_LABEL_ELEMENTS).map(element => {
      if (element.matches("input[type='submit']")) {
        return element.getAttribute("value") || "";
      }
      return element.getAttribute("aria-label") || element.textContent || "";
    }).join(" ").toLowerCase().slice(0, 2500);

    const checkoutDetected = Boolean(
      doc.querySelector(cardSelector) ||
      /\b(checkout|place order|pay now|payment details|complete purchase)\b/.test(labels)
    );

    return {
      checkoutDetected,
      paymentProviders: Array.from(providers).slice(0, 8),
      suspiciousIndicators: Array.from(warnings).slice(0, 8)
    };
  }

  _scan() {
    const win = this.contentWindow;
    const doc = win?.document;
    if (!doc || win !== win.top || !/^https?:$/.test(doc.location.protocol)) {
      return;
    }

    const enabled = pref("umbra.access.enabled", true);
    const cosmetic = enabled && pref("umbra.access.cosmetic", true);
    let removedOverlays = 0;
    if (cosmetic) {
      this._installCosmeticStyle(doc);
      removedOverlays = this._hidePromotionalOverlays(doc);
    } else {
      this._restoreCosmetics(doc);
    }

    const auth = this._detectAuthentication(doc);
    const payment = this._inspectPayment(doc);
    const report = {
      loginDetected: auth.loginDetected,
      registrationDetected: auth.registrationDetected,
      paywallDetected: this._detectPaywall(doc),
      checkoutDetected: payment.checkoutDetected,
      cookieDialogDetected: this._detectCookieDialog(doc),
      paymentProviders: payment.paymentProviders,
      suspiciousIndicators: payment.suspiciousIndicators,
      removedOverlays,
      isOnion: isOnionHostname(doc.location.hostname)
    };

    this.sendAsyncMessage("Umbra:PageReport", report);
  }
}
