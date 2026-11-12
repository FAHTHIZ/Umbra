/*
 * Pure, local-only signals used by the page inspector.
 * These helpers never retain a complete URL or payment address.
 */

import { isOnionHostname } from "./FilterRules.sys.mjs";

const PAYMENT_SCHEMES = new Set(["bitcoin", "ethereum", "lightning", "monero"]);

export function classifyPaymentURI(raw) {
  if (typeof raw !== "string" || raw.length > 4096) {
    return null;
  }
  const match = /^\s*([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (!match) {
    return null;
  }
  const scheme = match[1].toLowerCase();
  return PAYMENT_SCHEMES.has(scheme) ? scheme : null;
}

function isIPAddress(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (/^\[[0-9a-f:]+\]$/i.test(host)) {
    return true;
  }
  const parts = host.split(".");
  return parts.length === 4 && parts.every(part =>
    /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255
  );
}

/*
 * Receives a candidate target from a <meta http-equiv="refresh"> element.
 * Returns indicator codes only. Cross-origin refreshes are not inherently
 * malicious; they are surfaced as context for the user.
 */
export function inspectMetaRefreshRedirect(rawTarget, currentURL) {
  const indicators = new Set();
  if (typeof rawTarget !== "string" || rawTarget.length > 4096 ||
      typeof currentURL !== "string" || currentURL.length > 8192) {
    return [];
  }

  try {
    const current = new URL(currentURL);
    const target = new URL(rawTarget, current);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      indicators.add("redirect-non-web-scheme");
      return Array.from(indicators);
    }
    if (target.username || target.password) {
      indicators.add("redirect-credentials-in-url");
    }
    if (current.protocol === "https:" && target.protocol === "http:" &&
        !isOnionHostname(target.hostname)) {
      indicators.add("redirect-downgrade");
    }
    if (isIPAddress(target.hostname)) {
      indicators.add("redirect-to-ip-literal");
    }
    if (current.origin !== target.origin) {
      indicators.add("cross-origin-meta-refresh");
    }
  } catch (_) {
    indicators.add("invalid-meta-refresh-target");
  }
  return Array.from(indicators);
}
