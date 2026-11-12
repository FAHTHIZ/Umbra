/*
 * Umbra Access Engine parent-process entry point for Gecko-based browsers.
 *
 * This module is deliberately local-only. It does not fetch filter lists,
 * submit URLs, send telemetry, or use a cloud analysis service. It is a
 * foundation module; browser startup must call start() from the browser's
 * privileged startup path after the networking/profile services are ready.
 */

import { Services } from "resource://gre/modules/Services.sys.mjs";
import { classifyRequest, isOnionHostname, getRuleSummary } from
  "resource:///modules/umbra/FilterRules.sys.mjs";

const TOPIC = "http-on-modify-request";
const REPORT_TOPIC = "umbra-access-page-report";
const BLOCKED_TOPIC = "umbra-access-request-blocked";

function safeHost(uri) {
  try { return String(uri?.host || "").toLowerCase(); }
  catch (_) { return ""; }
}

function getResourceType(channel) {
  try {
    const info = channel.loadInfo;
    const policy = info.externalContentPolicyType;
    const Ci = Components.interfaces;
    const map = new Map([
      [Ci.nsIContentPolicy.TYPE_SCRIPT, "script"],
      [Ci.nsIContentPolicy.TYPE_IMAGE, "image"],
      [Ci.nsIContentPolicy.TYPE_STYLESHEET, "stylesheet"],
      [Ci.nsIContentPolicy.TYPE_OBJECT, "object"],
      [Ci.nsIContentPolicy.TYPE_SUBDOCUMENT, "subdocument"],
      [Ci.nsIContentPolicy.TYPE_XMLHTTPREQUEST, "xmlhttprequest"],
      [Ci.nsIContentPolicy.TYPE_WEBSOCKET, "websocket"],
      [Ci.nsIContentPolicy.TYPE_FONT, "font"],
      [Ci.nsIContentPolicy.TYPE_MEDIA, "media"],
      [Ci.nsIContentPolicy.TYPE_DOCUMENT, "document"]
    ]);
    return map.get(policy) || "other";
  } catch (_) {
    return "other";
  }
}

function getFirstPartyHost(channel) {
  try {
    const principal = channel.loadInfo?.loadingPrincipal;
    return principal?.URI?.host || "";
  } catch (_) {
    return "";
  }
}

function cancelChannel(channel) {
  try {
    channel.cancel(Components.results.NS_BINDING_ABORTED);
    return true;
  } catch (_) {
    return false;
  }
}

export const UmbraAccessEngine = {
  _started: false,
  _enabled: true,
  _cosmeticEnabled: true,
  _blockedCount: 0,

  start() {
    if (this._started) return;
    Services.obs.addObserver(this, TOPIC);
    this._started = true;
  },

  stop() {
    if (!this._started) return;
    Services.obs.removeObserver(this, TOPIC);
    this._started = false;
  },

  setEnabled(enabled) {
    this._enabled = Boolean(enabled);
  },

  setCosmeticEnabled(enabled) {
    this._cosmeticEnabled = Boolean(enabled);
  },

  getStatus() {
    return Object.freeze({
      started: this._started,
      enabled: this._enabled,
      cosmeticEnabled: this._cosmeticEnabled,
      blockedRequestCount: this._blockedCount,
      rules: getRuleSummary()
    });
  },

  observe(subject, topic) {
    if (topic !== TOPIC || !this._enabled) return;
    const channel = subject;
    let uri;
    try { uri = channel.URI; } catch (_) { return; }
    const hostname = safeHost(uri);
    if (!hostname) return;

    const firstPartyHost = getFirstPartyHost(channel);
    const resourceType = getResourceType(channel);
    const decision = classifyRequest({ hostname, resourceType, firstPartyHost });
    if (decision.action !== "block") return;

    if (cancelChannel(channel)) {
      this._blockedCount += 1;
      // Never include the full URL, path, query, referrer, or onion hostname
      // in the observer event. Consumers receive only a category/reason.
      Services.obs.notifyObservers(null, BLOCKED_TOPIC, decision.reason);
    }
  },

  publishPageReport(report) {
    // Accept only the fixed, bounded schema. Never forward URL, origin,
    // document text, field values, cookies, tokens or form contents.
    const safeReport = {
      loginDetected: Boolean(report?.loginDetected),
      registrationDetected: Boolean(report?.registrationDetected),
      paywallDetected: Boolean(report?.paywallDetected),
      checkoutDetected: Boolean(report?.checkoutDetected),
      cookieDialogDetected: Boolean(report?.cookieDialogDetected),
      paymentProviders: Array.isArray(report?.paymentProviders)
        ? report.paymentProviders.slice(0, 8).map(String).map(x => x.slice(0, 40))
        : [],
      suspiciousIndicators: Array.isArray(report?.suspiciousIndicators)
        ? report.suspiciousIndicators.slice(0, 8).map(String).map(x => x.slice(0, 64))
        : [],
      removedOverlays: Math.max(0, Math.min(100, Number(report?.removedOverlays) || 0)),
      isOnion: Boolean(report?.isOnion)
    };
    Services.obs.notifyObservers(null, REPORT_TOPIC, JSON.stringify(safeReport));
  }
};

export { REPORT_TOPIC, BLOCKED_TOPIC, isOnionHostname };
