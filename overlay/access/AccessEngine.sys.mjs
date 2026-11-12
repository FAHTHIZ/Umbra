/*
 * Umbra Access Engine — Gecko parent-process integration.
 *
 * Privacy invariants:
 * - no network requests, cloud inspection, telemetry, or remote rule fetches;
 * - never persist visited hosts, onion addresses, page content, or form data;
 * - only aggregate counters and coarse page classifications are kept in memory;
 * - request inspection runs on the channel already being handled by Gecko;
 * - top-level document navigation is never blocked by the starter rules.
 */

const { Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs");
const { HOST_RULES } = ChromeUtils.importESModule("resource:///modules/umbra/FilterRules.sys.mjs");
const { interfaces: Ci, results: Cr } = Components;

const FRAME_SCRIPT = "chrome://browser/content/umbra-access/content-frame.js";
const DASHBOARD_URL = "chrome://browser/content/umbra-access/dashboard.html";
const STATE_TOPIC = "umbra-access-state-changed";
const TOOLBAR_ID = "umbra-access-toolbar-button";

const DEFAULT_STATE = () => ({
  blockedAds: 0,
  blockedTrackers: 0,
  removedOverlays: 0,
  onionPagesInspected: 0,
  crossOriginCheckoutWarnings: 0,
  latestPage: {
    loginDetected: false,
    registrationDetected: false,
    paywallDetected: false,
    checkoutDetected: false,
    cookieDialogDetected: false,
    paymentProviders: [],
    suspiciousIndicators: [],
    isOnion: false
  }
});

let initialized = false;
let toolbarCreated = false;
let state = DEFAULT_STATE();
let contextHost = "";
let contextURL = "";
const temporaryExceptions = new Set();

function readBoolPref(name, fallback) {
  try {
    return Services.prefs.getBoolPref(name, fallback);
  } catch (_) {
    return fallback;
  }
}

function writeBoolPref(name, value) {
  Services.prefs.setBoolPref(name, Boolean(value));
  broadcastSettings();
  notifyStateChanged();
}

function notifyStateChanged() {
  try {
    Services.obs.notifyObservers(null, STATE_TOPIC);
  } catch (_) {}
}

function isEnabled() {
  return readBoolPref("umbra.access.enabled", false);
}

function categoryEnabled(category) {
  if (category === "ads") {
    return readBoolPref("umbra.access.blockAds", true);
  }
  if (category === "trackers") {
    return readBoolPref("umbra.access.blockTrackers", true);
  }
  return false;
}

function broadcastSettings() {
  try {
    Services.mm.broadcastAsyncMessage("Umbra:Settings", {
      enabled: isEnabled(),
      cosmetic: readBoolPref("umbra.access.cosmetic", true)
    });
  } catch (_) {
    // The network filter remains available if the frame-script manager is not ready.
  }
}

function sourceHostname(channel) {
  try {
    const info = channel.loadInfo;
    const principal = info.loadingPrincipal || info.triggeringPrincipal;
    const uri = principal && principal.URI;
    return uri && uri.host ? uri.host.toLowerCase() : "";
  } catch (_) {
    return "";
  }
}

function matchingRule(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host) {
    return null;
  }
  return HOST_RULES.find(rule =>
    host === rule.domain || host.endsWith("." + rule.domain)
  ) || null;
}

const requestObserver = {
  observe(subject, topic) {
    if (topic !== "http-on-modify-request" || !isEnabled()) {
      return;
    }

    let channel;
    try {
      channel = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch (_) {
      return;
    }

    let uri;
    let contentType;
    try {
      uri = channel.URI;
      if (!uri || (uri.scheme !== "http" && uri.scheme !== "https")) {
        return;
      }
      contentType = channel.loadInfo.externalContentPolicyType;
    } catch (_) {
      return;
    }

    // Never block a top-level navigation, even if its host appears in a rule.
    if (contentType === Ci.nsIContentPolicy.TYPE_DOCUMENT) {
      return;
    }

    const sourceHost = sourceHostname(channel);
    if (sourceHost && temporaryExceptions.has(sourceHost)) {
      return;
    }

    const rule = matchingRule(uri.host);
    if (!rule || !categoryEnabled(rule.category)) {
      return;
    }

    try {
      channel.cancel(Cr.NS_BINDING_ABORTED);
      if (rule.category === "ads") {
        state.blockedAds += 1;
      } else if (rule.category === "trackers") {
        state.blockedTrackers += 1;
      }
      notifyStateChanged();
    } catch (_) {
      // A channel that has already completed cannot be cancelled.
    }
  },

  QueryInterface: ChromeUtils.generateQI(["nsIObserver"])
};

const pageReportListener = {
  receiveMessage(message) {
    const incoming = message && message.data;
    if (!incoming || incoming.type !== "page-report") {
      return;
    }

    // Strictly accept a small schema. No URL, hostname, title, text, or form value
    // is accepted from the content process.
    const report = incoming.report || {};
    const providers = Array.isArray(report.paymentProviders)
      ? report.paymentProviders.filter(x => typeof x === "string").slice(0, 8)
      : [];
    const indicators = Array.isArray(report.suspiciousIndicators)
      ? report.suspiciousIndicators.filter(x => typeof x === "string").slice(0, 8)
      : [];

    state.latestPage = {
      loginDetected: Boolean(report.loginDetected),
      registrationDetected: Boolean(report.registrationDetected),
      paywallDetected: Boolean(report.paywallDetected),
      checkoutDetected: Boolean(report.checkoutDetected),
      cookieDialogDetected: Boolean(report.cookieDialogDetected),
      paymentProviders: providers,
      suspiciousIndicators: indicators,
      isOnion: Boolean(report.isOnion)
    };
    state.removedOverlays += Math.max(0, Math.min(50, Number(report.removedOverlays) || 0));
    if (state.latestPage.isOnion) {
      state.onionPagesInspected += 1;
    }
    notifyStateChanged();
  }
};

function onWindowReady(subject) {
  try {
    const { CustomizableUI } = ChromeUtils.importESModule("resource:///modules/CustomizableUI.sys.mjs");
    if (!toolbarCreated && !CustomizableUI.getWidget(TOOLBAR_ID)) {
      CustomizableUI.createWidget({
        id: TOOLBAR_ID,
        type: "custom",
        defaultArea: CustomizableUI.AREA_NAVBAR,
        onBuild(document) {
          const button = document.createXULElement("toolbarbutton");
          button.id = TOOLBAR_ID;
          button.className = "toolbarbutton-1 chromeclass-toolbar-additional";
          button.setAttribute("label", "Access");
          button.setAttribute("tooltiptext", "Umbra Access Engine");
          button.addEventListener("command", () => openDashboard(document.defaultView));
          return button;
        }
      });
      toolbarCreated = true;
    }
  } catch (error) {
    Cu.reportError(error);
  }
}

const windowReadyObserver = {
  observe(subject, topic) {
    if (topic === "browser-delayed-startup-finished") {
      onWindowReady(subject);
    }
  },
  QueryInterface: ChromeUtils.generateQI(["nsIObserver"])
};

function currentBrowserWindow() {
  return Services.wm.getMostRecentWindow("navigator:browser");
}

function openDashboard(win = currentBrowserWindow()) {
  if (!win || !win.gBrowser) {
    return;
  }

  try {
    const browser = win.gBrowser.selectedBrowser;
    const spec = browser && browser.currentURI ? browser.currentURI.spec : "";
    const parsed = spec ? Services.io.newURI(spec) : null;
    contextURL = parsed && (parsed.scheme === "http" || parsed.scheme === "https") ? spec : "";
    contextHost = parsed && contextURL ? parsed.host.toLowerCase() : "";
  } catch (_) {
    contextURL = "";
    contextHost = "";
  }

  win.gBrowser.addTab(DASHBOARD_URL, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
  });
  win.gBrowser.selectedTab = win.gBrowser.tabs[win.gBrowser.tabs.length - 1];
}

function setTemporaryException(enabled) {
  if (!contextHost) {
    return false;
  }
  if (enabled) {
    temporaryExceptions.add(contextHost);
  } else {
    temporaryExceptions.delete(contextHost);
  }
  notifyStateChanged();
  return true;
}

function clearCounters() {
  state = DEFAULT_STATE();
  notifyStateChanged();
}

function openReaderView() {
  if (!contextURL) {
    return false;
  }
  const win = currentBrowserWindow();
  if (!win || !win.gBrowser) {
    return false;
  }
  const readerURL = "about:reader?url=" + encodeURIComponent(contextURL);
  win.gBrowser.addTab(readerURL, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
  });
  return true;
}

function searchOnionSearch(query) {
  const value = String(query || "").trim();
  if (!value || value.length > 200) {
    return false;
  }
  const win = currentBrowserWindow();
  if (!win || !win.gBrowser) {
    return false;
  }
  // Only the text the user explicitly enters is sent. No current URL, page text,
  // source identity, or browsing context is appended to the query.
  const url = "https://onionsearch.io/search?q=" + encodeURIComponent(value);
  win.gBrowser.addTab(url, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
  });
  return true;
}

function getState() {
  return {
    enabled: isEnabled(),
    blockAds: readBoolPref("umbra.access.blockAds", true),
    blockTrackers: readBoolPref("umbra.access.blockTrackers", true),
    cosmetic: readBoolPref("umbra.access.cosmetic", true),
    blockedAds: state.blockedAds,
    blockedTrackers: state.blockedTrackers,
    removedOverlays: state.removedOverlays,
    onionPagesInspected: state.onionPagesInspected,
    exceptionActive: Boolean(contextHost && temporaryExceptions.has(contextHost)),
    contextAvailable: Boolean(contextURL),
    contextIsOnion: Boolean(contextHost.endsWith(".onion")),
    latestPage: { ...state.latestPage },
    localOnly: true,
    externalInspection: false,
    ruleCount: HOST_RULES.length
  };
}

export const UmbraAccessEngine = Object.freeze({
  init() {
    if (initialized) {
      return;
    }
    initialized = true;

    Services.obs.addObserver(requestObserver, "http-on-modify-request");
    Services.obs.addObserver(windowReadyObserver, "browser-delayed-startup-finished");

    // The first browser window may already have completed delayed startup by
    // the time this module is loaded from browser-first-window-ready.
    try {
      const windows = Services.wm.getEnumerator("navigator:browser");
      while (windows.hasMoreElements()) {
        onWindowReady(windows.getNext());
      }
    } catch (error) {
      Cu.reportError(error);
    }

    try {
      Services.mm.addMessageListener("Umbra:PageReport", pageReportListener);
      Services.mm.loadFrameScript(FRAME_SCRIPT, true);
      broadcastSettings();
    } catch (error) {
      Cu.reportError(error);
    }
  },
  getState,
  openDashboard,
  openReaderView,
  searchOnionSearch,
  clearCounters,
  setTemporaryException,
  setEnabled(value) {
    writeBoolPref("umbra.access.enabled", value);
  },
  setCategoryEnabled(category, value) {
    if (category === "ads") {
      writeBoolPref("umbra.access.blockAds", value);
    } else if (category === "trackers") {
      writeBoolPref("umbra.access.blockTrackers", value);
    } else if (category === "cosmetic") {
      writeBoolPref("umbra.access.cosmetic", value);
    }
  }
});
