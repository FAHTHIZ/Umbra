// Umbra Privacy dashboard. Read-only, local-only (CSP connect-src 'none').
// Runs in a chrome document; Services is a global.
import { evaluate } from "chrome://browser/content/umbra-privacy/privacy-checks.mjs";

const mods = {};
function load(name, url) {
  try { mods[name] = ChromeUtils.importESModule(url); } catch (_) { mods[name] = null; }
}
load("TorConnect", "moz-src:///toolkit/modules/TorConnect.sys.mjs");
load("SecurityLevel", "moz-src:///toolkit/components/securitylevel/SecurityLevel.sys.mjs");
load("Search", "moz-src:///toolkit/components/search/SearchService.sys.mjs");

const pref = (name, fallback) => {
  try {
    switch (Services.prefs.getPrefType(name)) {
      case Services.prefs.PREF_BOOL: return Services.prefs.getBoolPref(name);
      case Services.prefs.PREF_INT: return Services.prefs.getIntPref(name);
      case Services.prefs.PREF_STRING: return Services.prefs.getStringPref(name);
    }
  } catch (_) {}
  return fallback;
};

async function snapshot() {
  let search = null;
  try {
    const S = mods.Search?.SearchService;
    await S.init();
    search = (await S.getDefault())?.name ?? null;
  } catch (_) {}
  return {
    torStage: mods.TorConnect?.TorConnect?.stageName ?? null,
    torEnabled: mods.TorConnect?.TorConnect?.enabled ?? null,
    securityLevel: mods.SecurityLevel?.SecurityLevelPrefs?.securityLevel ?? null,
    securityCustom: mods.SecurityLevel?.SecurityLevelPrefs?.securityCustom ?? null,
    search,
    prefs: Object.fromEntries([
      "network.proxy.type", "network.proxy.socks", "network.proxy.socks_port", "network.proxy.socks_remote_dns",
      "network.proxy.allow_hijacking_localhost", "privacy.resistFingerprinting",
      "privacy.resistFingerprinting.letterboxing", "privacy.firstparty.isolate", "media.peerconnection.enabled",
      "dom.security.https_only_mode", "browser.privatebrowsing.autoStart", "browser.search.suggest.enabled",
      "umbra.access.enabled", "umbra.update.notify", "extensions.torbutton.use_nontor_proxy", "umbra.version", "umbra.upstream.torbrowser",
    ].map(n => [n, pref(n, null)])),
  };
}

const OPEN = {
  privacy: "about:preferences#privacy",
  connection: "about:preferences#connection",
  search: "about:preferences#search",
  security: "about:preferences#privacy-security-level",
  access: "chrome://browser/content/umbra-access/dashboard.html",
};

function open(key) {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  win?.openTrustedLinkIn(OPEN[key], "tab");
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function render(result) {
  const groups = document.getElementById("groups");
  groups.replaceChildren();
  for (const g of result.groups) {
    const box = el("div", "group");
    box.append(el("h2", null, g.title));
    for (const r of g.rows) {
      const row = el("div", "row");
      const label = el("div", "label");
      label.append(el("span", "dot " + r.status), document.createTextNode(r.label));
      row.append(label, el("div", "value", r.value), el("div", "detail", r.detail));
      box.append(row);
    }
    if (g.actions?.length) {
      const a = el("div", "actions");
      for (const [key, text] of g.actions) {
        const b = el("button", null, text);
        b.addEventListener("click", () => open(key));
        a.append(b);
      }
      box.append(a);
    }
    groups.append(box);
  }
  const o = document.getElementById("overall");
  o.className = "pill " + result.overall.status;
  o.textContent = result.overall.text;
  document.getElementById("version").textContent = result.version;
}

async function refresh() {
  render(evaluate(await snapshot()));
}

refresh();
for (const topic of ["TorConnectStageChange", "TorBootstrapStatus", "browser-search-engine-modified"]) {
  try { Services.obs.addObserver(refresh, topic); } catch (_) {}
}
Services.prefs.addObserver("", refresh);
window.addEventListener("unload", () => {
  Services.prefs.removeObserver("", refresh);
  for (const topic of ["TorConnectStageChange", "TorBootstrapStatus", "browser-search-engine-modified"]) {
    try { Services.obs.removeObserver(refresh, topic); } catch (_) {}
  }
});
window.UmbraPrivacy = { refresh, snapshot };
