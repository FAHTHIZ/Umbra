/*
 * JSWindowActor child side. Runs in the content process and inspects only
 * bounded DOM metadata. Never reads input values, cookies, storage, page URL,
 * complete page text, or authentication/payment secrets.
 */

export class UmbraAccessChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type === "DOMContentLoaded" || event.type === "pageshow") {
      this.scan();
    }
  }

  actorCreated() {
    this.contentWindow.addEventListener("DOMContentLoaded", this, true);
    this.contentWindow.addEventListener("pageshow", this, true);
  }

  didDestroy() {
    try {
      this.contentWindow.removeEventListener("DOMContentLoaded", this, true);
      this.contentWindow.removeEventListener("pageshow", this, true);
    } catch (_) {}
  }

  scan() {
    const win = this.contentWindow;
    const doc = win?.document;
    if (!doc || win !== win.top || !/^https?:$/.test(win.location.protocol)) return;

    const q = selector => {
      try { return doc.querySelector(selector); } catch (_) { return null; }
    };
    const qa = selector => {
      try { return Array.from(doc.querySelectorAll(selector)); } catch (_) { return []; }
    };

    const authForms = qa("form").slice(0, 50);
    let loginDetected = false;
    let registrationDetected = false;
    for (const form of authForms) {
      if (!form.querySelector('input[type="password"]')) continue;
      loginDetected = true;
      if (form.querySelector('input[type="email"], input[autocomplete="email"]')) {
        registrationDetected = true;
      }
    }

    const cookieDialogDetected = Boolean(q(
      '#onetrust-banner-sdk, #onetrust-consent-sdk, .cky-consent-container, ' +
      '.cc-window, [id*="cookie-consent" i], [class*="cookie-consent" i], ' +
      '[aria-label*="cookie" i][role="dialog"]'
    ));
    const paywallDetected = Boolean(q(
      '[class*="paywall" i], [id*="paywall" i], [data-testid*="paywall" i], ' +
      '.meteredContent, [class*="subscription-wall" i], [data-paywall]'
    ));

    const providerHosts = [
      ["stripe.com", "Stripe"], ["paypal.com", "PayPal"],
      ["braintreepayments.com", "Braintree"], ["adyen.com", "Adyen"],
      ["checkout.com", "Checkout.com"], ["squareup.com", "Square"],
      ["authorize.net", "Authorize.Net"], ["razorpay.com", "Razorpay"],
      ["paystack.com", "Paystack"], ["paddle.com", "Paddle"],
      ["lemonsqueezy.com", "Lemon Squeezy"]
    ];
    const providers = new Set();
    for (const element of qa("script[src], iframe[src], form[action]").slice(0, 100)) {
      const attr = element.matches("form") ? "action" : "src";
      const raw = element.getAttribute(attr);
      if (!raw) continue;
      try {
        const host = new URL(raw, win.location.href).hostname.toLowerCase();
        for (const [domain, name] of providerHosts) {
          if (host === domain || host.endsWith("." + domain)) providers.add(name);
        }
      } catch (_) {}
    }

    const cardSelector =
      'input[autocomplete*="cc-number" i], input[autocomplete*="cc-exp" i], ' +
      'input[name*="card-number" i], input[name*="cardnumber" i]';
    const checkoutLabels = qa('button, [role="button"], input[type="submit"], h1, h2')
      .slice(0, 30)
      .map(el => el.getAttribute("aria-label") || (el.matches("input") ? el.getAttribute("value") : el.textContent) || "")
      .join(" ").toLowerCase().slice(0, 1500);
    const checkoutDetected = Boolean(q(cardSelector) ||
      /\b(checkout|place order|pay now|payment details|complete purchase)\b/.test(checkoutLabels));

    const suspiciousIndicators = [];
    for (const form of qa("form[action]").slice(0, 50)) {
      if (!form.querySelector(cardSelector)) continue;
      try {
        const target = new URL(form.getAttribute("action"), win.location.href);
        const current = new URL(win.location.href);
        const onion = target.hostname.toLowerCase().endsWith(".onion");
        if (target.protocol === "http:" && !onion) suspiciousIndicators.push("insecure-payment-action");
        const recognized = [...providers].length > 0;
        if (target.origin !== current.origin && !recognized) {
          suspiciousIndicators.push("unrecognized-payment-destination");
        }
      } catch (_) {
        suspiciousIndicators.push("invalid-payment-destination");
      }
    }

    // Conservative cosmetic cleanup: only hide clearly labelled ad containers.
    // Never click consent buttons or dismiss authentication/payment dialogs.
    let removedOverlays = 0;
    for (const element of qa(
      '[id*="newsletter-modal" i], [class*="newsletter-modal" i], ' +
      '[id*="promo-overlay" i], [class*="promo-overlay" i]'
    ).slice(0, 20)) {
      if (element.querySelector('input[type="password"], input[autocomplete^="cc-"]')) continue;
      const style = win.getComputedStyle(element);
      if (style.position !== "fixed" || Number.parseInt(style.zIndex, 10) < 10) continue;
      element.hidden = true;
      removedOverlays += 1;
    }

    const isOnion = win.location.hostname.toLowerCase().endsWith(".onion");
    this.sendAsyncMessage("Umbra:PageReport", {
      loginDetected,
      registrationDetected,
      paywallDetected,
      checkoutDetected,
      cookieDialogDetected,
      paymentProviders: [...providers].slice(0, 8),
      suspiciousIndicators: [...new Set(suspiciousIndicators)].slice(0, 8),
      removedOverlays,
      isOnion
    });
  }
}
