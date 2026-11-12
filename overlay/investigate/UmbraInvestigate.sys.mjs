// Umbra Investigate: a manual, onion-only investigation browser.
//
// Runs as a *separate* Umbra instance with its own profile (profile.umbra-investigate),
// launched from the main browser. Inside that instance (pref umbra.investigate.mode):
//
//  1. Onion-only guard, two independent layers:
//     a) http-on-modify-request observer: any http(s)/ws(s) channel whose host is not a v3
//        .onion is cancelled before it connects. Redirect targets and WebSocket handshakes are
//        new channels, so they pass through this check too.
//     b) a protocol-proxy channel filter: anything that is not onion gets a blackhole proxy
//        (SOCKS 127.0.0.1:9, nothing listens there), so even a request that skipped (a) cannot
//        reach Tor or the clearnet. This also covers speculative connections.
//  2. Traffic log: request/response metadata (no bodies; cookie/authorization values
//     redacted), memory-only, exportable as HAR 1.2 into a case.
//  3. A read-only page actor (UmbraInvestigateChild) for on-demand inspection and DOM capture.
//     It never fills or submits anything.
//
// Tor itself (bootstrap, bridges, Moat, directory fetches) runs in the main instance's tor
// process, not in Gecko, so the guard never needs a clearnet exception.
import * as Core from "resource:///modules/umbra/investigate-core.mjs";
import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";

export const DASHBOARD_URL = "chrome://browser/content/umbra-investigate/investigate.html";
export const BLOCKED_URL = "chrome://browser/content/umbra-investigate/blocked.html";
const PROFILE_NAME = "profile.umbra-investigate";
const MENU_ID = "umbra-investigate-menuitem";
const WIDGET_ID = "umbra-investigate-button";
const PLACED_PREF = "umbra.investigate.toolbarPlaced";
const MAX_LOG = 5000;
const BLACKHOLE = { host: "127.0.0.1", port: 9 };
const ONION_SEARCH = "DuckDuckGo (.onion)";

let initialized = false;
let guardInstalled = false;
const state = {
  log: [], // traffic records, newest last
  byChannel: new Map(),
  stats: { allowed: 0, blocked: 0, blackholed: 0 },
  blockedHosts: new Map(),
  startedAt: new Date().toISOString(),
};

export function isInvestigateMode() {
  return Services.prefs.getBoolPref("umbra.investigate.mode", false);
}

// ------------------------------------------------------------------ guard

function headerList(channel, response) {
  const out = [];
  const v = { visitHeader(name, value) { out.push({ name, value }); } };
  try {
    response ? channel.visitResponseHeaders(v) : channel.visitRequestHeaders(v);
  } catch (_) {}
  return Core.redactHeaders(out);
}

function browserFor(channel) {
  try {
    const bc = channel.loadInfo?.browsingContext ?? channel.loadInfo?.targetBrowsingContext;
    return bc?.top?.embedderElement ?? null;
  } catch (_) {
    return null;
  }
}

function browserIdFor(channel) {
  try {
    return channel.loadInfo?.browsingContext?.top?.browserId ?? channel.browserId ?? 0;
  } catch (_) {
    return 0;
  }
}

function isTopDocument(channel) {
  try {
    return channel.loadInfo.externalContentPolicyType === Ci.nsIContentPolicy.TYPE_DOCUMENT;
  } catch (_) {
    return false;
  }
}

const TYPE_NAMES = {};
for (const k of ["DOCUMENT", "SUBDOCUMENT", "SCRIPT", "IMAGE", "STYLESHEET", "OBJECT", "FONT", "MEDIA", "WEBSOCKET",
  "XMLHTTPREQUEST", "FETCH", "PING", "BEACON", "CSP_REPORT", "WEB_MANIFEST", "SAVEAS_DOWNLOAD", "SPECULATIVE",
  "IMAGESET", "OTHER", "OBJECT_SUBREQUEST", "DTD", "XSLT", "WEB_TRANSPORT", "INTERNAL_WORKER", "INTERNAL_SERVICE_WORKER"]) {
  const v = Ci.nsIContentPolicy["TYPE_" + k];
  if (typeof v === "number") TYPE_NAMES[v] = k.toLowerCase();
}
const blockedIds = new Set();

function pushRecord(r) {
  state.log.push(r);
  if (state.log.length > MAX_LOG) {
    const old = state.log.shift();
    state.byChannel.delete(old.channelId);
  }
}

function redirectedFrom(channel) {
  try {
    const chain = channel.loadInfo.redirectChain;
    const last = chain?.[chain.length - 1];
    return last?.principal?.spec || last?.principal?.URI?.spec || null;
  } catch (_) {
    return null;
  }
}

// browser -> { url, target }: the cancelled top-level load may still be followed by the
// network error page, which would replace our explanation; the progress listener below
// re-applies it when that error page commits.
const pendingBlocked = new WeakMap();

function loadBlocked(browser, target) {
  try {
    browser.fixupAndLoadURIString(target, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  } catch (e) {
    console.error("UmbraInvestigate: blocked page", e);
  }
}

function showBlockedPage(browser, url, reason, from) {
  const target = `${BLOCKED_URL}?u=${encodeURIComponent(url)}&r=${encodeURIComponent(reason)}` +
    (from ? `&from=${encodeURIComponent(from)}` : "");
  pendingBlocked.set(browser, { url, from, target, until: Date.now() + 10000 });
  Services.tm.dispatchToMainThread(() => loadBlocked(browser, target));
}

const blockedPageListener = {
  onLocationChange(browser, webProgress, request, location, flags) {
    if (!webProgress?.isTopLevel) return;
    const p = pendingBlocked.get(browser);
    if (!p) return;
    const spec = location?.spec || "";
    if (spec.startsWith(BLOCKED_URL)) {
      pendingBlocked.delete(browser);
      return;
    }
    if (Date.now() > p.until) {
      pendingBlocked.delete(browser);
      return;
    }
    const isError = flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_ERROR_PAGE;
    if (isError && (spec === p.url || spec === p.from || spec.startsWith("about:neterror"))) {
      Services.tm.dispatchToMainThread(() => loadBlocked(browser, p.target));
    }
  },
};

function watchWindow(win) {
  try {
    win.gBrowser?.addTabsProgressListener(blockedPageListener);
  } catch (e) {
    console.error("UmbraInvestigate: progress listener", e);
  }
}

function blockChannel(channel, base, reason, layer) {
  blockedIds.add(channel.channelId);
  if (blockedIds.size > MAX_LOG * 2) blockedIds.clear();
  const from = redirectedFrom(channel);
  try {
    channel.cancel(Cr.NS_ERROR_BLOCKED_BY_POLICY ?? Cr.NS_BINDING_ABORTED);
  } catch (_) {}
  state.stats.blocked++;
  state.blockedHosts.set(base.host, (state.blockedHosts.get(base.host) || 0) + 1);
  pushRecord({ ...base, blocked: reason, layer, redirectedFrom: from, requestHeaders: [] });
  if (base.topLevel) {
    const b = browserFor(channel);
    if (b) showBlockedPage(b, base.url, reason, from);
  }
  Services.obs.notifyObservers(null, "umbra-investigate-blocked", JSON.stringify({ url: base.url, reason }));
}

const requestObserver = {
  observe(subject, topic) {
    let channel;
    try {
      channel = subject.QueryInterface(Ci.nsIHttpChannel);
    } catch (_) {
      return;
    }
    const url = channel.URI.spec;
    if (topic === "http-on-opening-request" || topic === "http-on-modify-request") {
      if (blockedIds.has(channel.channelId)) return;
      const known = state.byChannel.get(channel.channelId);
      if (known) {
        // second look (modify-request): refresh headers, the request is already allowed
        if (topic === "http-on-modify-request") known.requestHeaders = headerList(channel, false);
        return;
      }
      const d = Core.guardDecision(url);
      const base = {
        channelId: channel.channelId,
        started: new Date().toISOString(),
        t0: Date.now(),
        method: channel.requestMethod,
        url,
        host: d.host,
        type: TYPE_NAMES[channel.loadInfo?.externalContentPolicyType] || "other",
        browserId: browserIdFor(channel),
        topLevel: isTopDocument(channel),
      };
      if (!d.allow) {
        blockChannel(channel, base, d.reason, "request-observer");
        return;
      }
      state.stats.allowed++;
      const r = { ...base, requestHeaders: headerList(channel, false) };
      state.byChannel.set(channel.channelId, r);
      pushRecord(r);
      return;
    }
    // response topics
    const r = state.byChannel.get(channel.channelId);
    if (!r) return;
    try {
      r.status = channel.responseStatus;
      r.statusText = channel.responseStatusText;
    } catch (_) {}
    r.responseHeaders = headerList(channel, true);
    r.mimeType = channel.contentType || "";
    r.time = Date.now() - r.t0;
    r.cached = topic !== "http-on-examine-response";
    try {
      const maj = {}, min = {};
      channel.QueryInterface(Ci.nsIHttpChannelInternal).getResponseVersion(maj, min);
      r.httpVersion = `HTTP/${maj.value}.${min.value}`;
    } catch (_) {}
  },
};

const RESPONSE_TOPICS = ["http-on-examine-response", "http-on-examine-cached-response", "http-on-examine-merged-response"];

const proxyFilter = {
  applyFilter(channel, proxyInfo, callback) {
    let host = "";
    let allow = true;
    try {
      const d = Core.guardDecision(channel.URI.spec);
      allow = d.allow;
      host = d.host;
    } catch (_) {
      allow = false;
    }
    if (allow) {
      callback.onProxyFilterResult(proxyInfo);
      return;
    }
    state.stats.blackholed++;
    try {
      let hc = null;
      try {
        hc = channel.QueryInterface(Ci.nsIHttpChannel);
      } catch (_) {}
      const id = hc?.channelId ?? channel.channelId;
      if (id && !blockedIds.has(id)) {
        const base = { channelId: id, started: new Date().toISOString(), t0: Date.now(), method: hc?.requestMethod ?? "",
          url: channel.URI.spec, host, type: TYPE_NAMES[channel.loadInfo?.externalContentPolicyType] || "other",
          browserId: browserIdFor(channel), topLevel: isTopDocument(channel) };
        const reason = Core.guardDecision(channel.URI.spec).reason;
        if (hc) {
          // Reached here before any request observer saw it (e.g. a redirect target whose proxy is
          // resolved during redirect setup). Cancel and explain exactly like layer 1 would.
          blockChannel(hc, base, reason, "proxy-blackhole");
        } else {
          blockedIds.add(id);
          state.stats.blocked++;
          state.blockedHosts.set(host, (state.blockedHosts.get(host) || 0) + 1);
          pushRecord({ ...base, blocked: reason, layer: "proxy-blackhole", requestHeaders: [] });
        }
      }
    } catch (_) {}
    const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
    callback.onProxyFilterResult(pps.newProxyInfo("socks", BLACKHOLE.host, BLACKHOLE.port, "", "",
      Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST, 0xffffffff, null));
  },
};

export function installGuard() {
  if (guardInstalled) return;
  guardInstalled = true;
  Services.obs.addObserver(requestObserver, "http-on-opening-request");
  Services.obs.addObserver(requestObserver, "http-on-modify-request");
  for (const t of RESPONSE_TOPICS) Services.obs.addObserver(requestObserver, t);
  const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
  // Position 1: after Tor Browser's per-site isolation filter (position 0), so ours has the final word.
  pps.registerChannelFilter(proxyFilter, 1);
  Services.obs.addObserver(() => clearLog(), "new-identity-requested");
}

export function guardStatus() {
  return {
    installed: guardInstalled,
    mode: isInvestigateMode(),
    layers: guardInstalled ? ["request-observer", "proxy-blackhole"] : [],
    stats: { ...state.stats },
    blockedHosts: [...state.blockedHosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50),
    since: state.startedAt,
    socks: {
      host: Services.prefs.getStringPref("network.proxy.socks", ""),
      port: Services.prefs.getIntPref("network.proxy.socks_port", 0),
      remoteDns: Services.prefs.getBoolPref("network.proxy.socks_remote_dns", false),
      type: Services.prefs.getIntPref("network.proxy.type", 0),
    },
  };
}

/** Copy of the traffic log (optionally for one browser). */
export function getLog({ browserId = null, limit = MAX_LOG } = {}) {
  const rows = browserId == null ? state.log : state.log.filter(r => r.browserId === browserId);
  return rows.slice(-limit).map(({ t0, ...r }) => ({ ...r }));
}

export function clearLog() {
  state.log.length = 0;
  state.byChannel.clear();
  state.blockedHosts.clear();
  blockedIds.clear();
  state.stats = { allowed: 0, blocked: 0, blackholed: 0 };
  state.startedAt = new Date().toISOString();
}

export function harFor(records) {
  return Core.toHar(records, {
    creatorVersion: Services.prefs.getStringPref("umbra.version", "0"),
    browser: { name: "Umbra (Tor Browser " + (AppConstants.BASE_BROWSER_VERSION || "?") + ")", version: Services.appinfo.platformVersion },
  });
}

// ------------------------------------------------------------------ page actor

function registerActor() {
  try {
    ChromeUtils.registerWindowActor("UmbraInvestigate", {
      child: { esModuleURI: "resource:///modules/umbra/UmbraInvestigateChild.sys.mjs" },
      matches: ["http://*/*", "https://*/*"],
      allFrames: false,
    });
  } catch (e) {
    if (!String(e).includes("NotSupportedError")) throw e;
  }
}

async function ask(browser, name) {
  const wg = browser?.browsingContext?.currentWindowGlobal;
  if (!wg) throw new Error("no page loaded in this tab");
  return wg.getActor("UmbraInvestigate").sendQuery(name);
}

/** Read-only structural inspection of the page in `browser`, classified. */
export async function inspect(browser) {
  const d = await ask(browser, "Inspect");
  return { descriptor: d, report: Core.classifyPage(d) };
}

/** DOM snapshot (serialized current DOM, after scripts ran) of the page in `browser`. */
export function serialize(browser) {
  return ask(browser, "Serialize");
}

// ------------------------------------------------------------------ versions

export function toolVersions() {
  const p = Services.prefs;
  return {
    umbra: p.getStringPref("umbra.version", "unknown"),
    torBrowser: AppConstants.BASE_BROWSER_VERSION || p.getStringPref("torbrowser.version", "unknown"),
    gecko: Services.appinfo.platformVersion,
    geckoBuildID: Services.appinfo.platformBuildID,
    os: Services.appinfo.OS,
    investigateCore: Core.CORE_VERSION,
    tor: "runs in the main Umbra instance (see its about:tor / Tor connection settings)",
  };
}

// ------------------------------------------------------------------ launcher (main instance)

function mainProfileDir() {
  return Services.dirsvc.get("ProfD", Ci.nsIFile);
}

export function investigateProfileDir() {
  const dir = mainProfileDir().parent.clone();
  dir.append(PROFILE_NAME);
  return dir;
}

/** Prefs written to the Investigate profile's user.js on every launch. */
export function investigatePrefs() {
  const p = Services.prefs;
  return {
    "umbra.investigate.mode": true,
    // Reuse the main instance's Tor SOCKS endpoint; remote DNS; never fall back to direct.
    "network.proxy.type": 1,
    "network.proxy.socks": p.getStringPref("network.proxy.socks", "127.0.0.1"),
    "network.proxy.socks_port": p.getIntPref("network.proxy.socks_port", 9150),
    "network.proxy.socks_remote_dns": true,
    "network.proxy.socks_version": 5,
    "network.proxy.no_proxies_on": "",
    "network.proxy.allow_hijacking_localhost": true,
    "network.proxy.failover_direct": false,
    // No speculative or background connections (the guard would block them anyway).
    "network.prefetch-next": false,
    "network.dns.disablePrefetch": true,
    "network.dns.disablePrefetchFromHTTPS": true,
    "network.predictor.enabled": false,
    "network.http.speculative-parallel-limit": 0,
    "browser.urlbar.speculativeConnect.enabled": false,
    "browser.places.speculativeConnect.enabled": false,
    "browser.search.suggest.enabled": false,
    "browser.urlbar.suggest.searches": false,
    "extensions.update.enabled": false,
    "extensions.getAddons.cache.enabled": false,
    "umbra.update.notify": false,
    "umbra.access.enabled": false,
    // Security level Safest by default (JavaScript off). The user can lower it per need.
    "browser.security_level.security_slider": 1,
    // Nothing persists unless the user captures it into a case.
    "browser.privatebrowsing.autoStart": true,
    "signon.rememberSignons": false,
    "browser.formfill.enable": false,
    "browser.startup.page": 1,
    "browser.startup.homepage": DASHBOARD_URL,
    "browser.download.useDownloadDir": false,
    "browser.download.always_ask_before_handling_new_types": true,
    // Onion services are not HTTPS-only by nature; Tor already encrypts end to end.
    "dom.security.https_only_mode": false,
    "dom.security.https_only_mode_pbm": false,
  };
}

export function userJs(prefs = investigatePrefs()) {
  return "// Written by Umbra Investigate on every launch. Do not edit; changes are overwritten.\n" +
    Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n") + "\n";
}

export async function prepareProfile() {
  const dir = investigateProfileDir();
  await IOUtils.makeDirectory(dir.path, { permissions: 0o700, ignoreExisting: true });
  await IOUtils.writeUTF8(PathUtils.join(dir.path, "user.js"), userJs());
  try {
    await IOUtils.setPermissions(PathUtils.join(dir.path, "user.js"), 0o600);
  } catch (_) {}
  return dir;
}

export function launchPlan(url = null) {
  if (url && !Core.guardDecision(url).allow) throw new Error("Umbra Investigate only opens onion services");
  const args = ["--new-instance", "--profile", investigateProfileDir().path];
  if (url) args.push(url);
  return { binary: Services.dirsvc.get("XREExeF", Ci.nsIFile).path, args, env: { TOR_PROVIDER: "none" } };
}

export async function launch(url = null) {
  const plan = launchPlan(url);
  await prepareProfile();
  const env = Services.env;
  const prev = env.exists("TOR_PROVIDER") ? env.get("TOR_PROVIDER") : null;
  env.set("TOR_PROVIDER", "none");
  try {
    const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    proc.init(Services.dirsvc.get("XREExeF", Ci.nsIFile));
    proc.runAsync(plan.args, plan.args.length);
    return proc;
  } finally {
    env.set("TOR_PROVIDER", prev ?? "");
  }
}

// ------------------------------------------------------------------ UI wiring

function decorateMain(win) {
  try {
    const doc = win.document;
    if (doc.getElementById(MENU_ID)) return;
    const popup = doc.getElementById("menu_ToolsPopup");
    if (!popup) return;
    const item = doc.createXULElement("menuitem");
    item.id = MENU_ID;
    item.setAttribute("label", "Umbra Investigate (onion-only)");
    item.addEventListener("command", () => win.openTrustedLinkIn(DASHBOARD_URL, "tab"));
    const after = doc.getElementById("umbra-source-menuitem") || doc.getElementById("umbra-privacy-menuitem");
    popup.insertBefore(item, after ? after.nextSibling : doc.getElementById("menu_pageInfo"));
  } catch (e) {
    console.error("UmbraInvestigate:", e);
  }
}

function placeWidget() {
  try {
    const { CustomizableUI } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs");
    if (CustomizableUI.getWidget(WIDGET_ID)?.provider === CustomizableUI.PROVIDER_API) return;
    CustomizableUI.createWidget({
      id: WIDGET_ID,
      type: "custom",
      defaultArea: CustomizableUI.AREA_NAVBAR,
      onBuild(document) {
        const b = document.createXULElement("toolbarbutton");
        b.id = WIDGET_ID;
        b.className = "toolbarbutton-1 chromeclass-toolbar-additional";
        b.setAttribute("label", "Investigate");
        b.setAttribute("tooltiptext", "Umbra Investigate: onion-only. Inspect page, capture evidence, traffic log");
        b.style.listStyleImage = "url(chrome://global/skin/icons/search-glass.svg)";
        b.addEventListener("command", () => document.defaultView.openTrustedLinkIn(DASHBOARD_URL, "tab"));
        return b;
      },
    });
    if (!Services.prefs.getBoolPref(PLACED_PREF, false)) {
      if (!CustomizableUI.getPlacementOfWidget(WIDGET_ID)) {
        const anchor = CustomizableUI.getPlacementOfWidget("new-identity-button");
        CustomizableUI.addWidgetToArea(WIDGET_ID, CustomizableUI.AREA_NAVBAR,
          anchor && anchor.area === CustomizableUI.AREA_NAVBAR ? anchor.position + 1 : undefined);
      }
      Services.prefs.setBoolPref(PLACED_PREF, true);
    }
  } catch (e) {
    console.error("UmbraInvestigate widget:", e);
  }
}

/** Onion-only default search (OnionSearch.io is a clearnet site, so it is blocked in this mode). */
export async function setOnionSearchDefault() {
  try {
    const { SearchService } = ChromeUtils.importESModule("moz-src:///toolkit/components/search/SearchService.sys.mjs");
    await SearchService.init();
    const e = SearchService.getEngineByName(ONION_SEARCH);
    if (!e) return null;
    const why = SearchService.CHANGE_REASON?.USER ?? 0;
    await SearchService.setDefault(e, why);
    try {
      await SearchService.setDefaultPrivate(e, why);
    } catch (_) {}
    return (await SearchService.getDefault()).name;
  } catch (err) {
    console.error("UmbraInvestigate search:", err);
    return null;
  }
}

export const UmbraInvestigate = {
  init() {
    if (initialized) return;
    initialized = true;
    if (isInvestigateMode()) {
      installGuard();
      registerActor();
      Services.obs.addObserver(w => watchWindow(w), "browser-delayed-startup-finished");
      for (const w of Services.wm.getEnumerator("navigator:browser")) if (w.gBrowser) watchWindow(w);
      placeWidget();
      setOnionSearchDefault();
      return;
    }
    if (Services.prefs.getBoolPref("umbra.source.mode", false)) return;
    Services.obs.addObserver(w => decorateMain(w), "browser-delayed-startup-finished");
    for (const w of Services.wm.getEnumerator("navigator:browser")) decorateMain(w);
  },
  isInvestigateMode,
  installGuard,
  guardStatus,
  getLog,
  clearLog,
  harFor,
  inspect,
  serialize,
  toolVersions,
  investigateProfileDir,
  investigatePrefs,
  userJs,
  prepareProfile,
  launchPlan,
  launch,
  setOnionSearchDefault,
  Core,
};
