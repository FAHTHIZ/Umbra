// Umbra Source: reach SecureDrop instances from an *isolated* Umbra instance.
//
// Isolation model (see docs/modules/SOURCE.md):
//  - a separate profile directory (umbra-source) next to the main profile,
//    so it shares no history, cookies, storage, permissions or extensions
//  - Security level "Safest" (JavaScript off; SecureDrop works without it)
//  - no Umbra background requests (release notice off, Access Engine off)
//  - reuses the running Tor through the same SOCKS endpoint (TOR_PROVIDER=none,
//    so the second instance never launches a second tor), with remote DNS and
//    the same per-site circuit isolation
// Umbra never submits anything itself: SecureDrop's own onion pages do that.
export const SOURCE_URL = "chrome://browser/content/umbra-source/source.html";
const ITEM_ID = "umbra-source-menuitem";
const PROFILE_NAME = "profile.umbra-source";
let initialized = false;

const ONION_RE = /^[a-z2-7]{56}\.onion$/;

function mainProfileDir() {
  return Services.dirsvc.get("ProfD", Ci.nsIFile);
}

/** The Source profile lives next to the main profile (portable bundle stays self-contained). */
export function sourceProfileDir() {
  const dir = mainProfileDir().parent.clone();
  dir.append(PROFILE_NAME);
  return dir;
}

function q(v) {
  return JSON.stringify(v);
}

/** Prefs written to the Source profile's user.js on every launch. */
export function sourcePrefs() {
  const p = Services.prefs;
  const socks = p.getStringPref("network.proxy.socks", "127.0.0.1");
  const port = p.getIntPref("network.proxy.socks_port", 9150);
  return {
    // Reuse the main instance's Tor SOCKS endpoint; fail closed if it goes away.
    "network.proxy.type": 1,
    "network.proxy.socks": socks,
    "network.proxy.socks_port": port,
    "network.proxy.socks_remote_dns": true,
    "network.proxy.socks_version": 5,
    "network.proxy.no_proxies_on": "",
    "network.proxy.allow_hijacking_localhost": true,
    "network.proxy.failover_direct": false,
    // Safest: JavaScript disabled everywhere, minimal attack surface.
    "browser.security_level.security_slider": 1,
    "browser.privatebrowsing.autoStart": true,
    // No Umbra background traffic. (Extension prefs are left alone on purpose:
    // the security level is enforced partly by Tor Browser's bundled NoScript.)
    "umbra.update.notify": false,
    "umbra.access.enabled": false,
    "umbra.source.mode": true,
    "browser.startup.page": 0,
    "browser.download.useDownloadDir": false,
    "browser.download.always_ask_before_handling_new_types": true,
  };
}

export function userJs(prefs = sourcePrefs()) {
  return (
    "// Written by Umbra Source on every launch. Do not edit; changes are overwritten.\n" +
    Object.entries(prefs).map(([k, v]) => `user_pref(${q(k)}, ${q(v)});`).join("\n") +
    "\n"
  );
}

function writeFile(file, text) {
  const out = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
  out.init(file, 0x02 | 0x08 | 0x20, 0o600, 0);
  const conv = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
  conv.init(out, "UTF-8");
  conv.writeString(text);
  conv.close();
}

export function prepareProfile() {
  const dir = sourceProfileDir();
  if (!dir.exists()) {
    dir.create(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
  }
  const uj = dir.clone();
  uj.append("user.js");
  writeFile(uj, userJs());
  return dir;
}

/** Only onion URLs from SecureDrop entries (or the Source page itself) may be opened. */
export function isAllowedTarget(url) {
  try {
    const u = Services.io.newURI(url);
    return (u.scheme === "http" || u.scheme === "https") && ONION_RE.test(u.host);
  } catch (_) {
    return false;
  }
}

function binary() {
  // XREExeF is the real Gecko binary (firefox.real on Linux, firefox.exe on Windows).
  return Services.dirsvc.get("XREExeF", Ci.nsIFile);
}

/** Build the launch plan (pure, testable). */
export function launchPlan(url) {
  if (!isAllowedTarget(url)) {
    throw new Error("Umbra Source only opens onion services");
  }
  return {
    binary: binary().path,
    args: ["--new-instance", "--profile", sourceProfileDir().path, url],
    env: { TOR_PROVIDER: "none" },
  };
}

/** Launch the isolated Source instance. Returns the nsIProcess (tests kill it). */
export function launch(url) {
  const plan = launchPlan(url);
  prepareProfile();
  const env = Services.env;
  const prev = env.exists("TOR_PROVIDER") ? env.get("TOR_PROVIDER") : null;
  env.set("TOR_PROVIDER", "none");
  try {
    const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    proc.init(binary());
    proc.runAsync(plan.args, plan.args.length);
    return proc;
  } finally {
    // Restore the parent's environment (the child already inherited it).
    if (prev === null) {
      env.set("TOR_PROVIDER", "");
    } else {
      env.set("TOR_PROVIDER", prev);
    }
  }
}

function decorate(win) {
  try {
    const doc = win.document;
    if (doc.getElementById(ITEM_ID)) {
      return;
    }
    const popup = doc.getElementById("menu_ToolsPopup");
    if (!popup) {
      return;
    }
    const item = doc.createXULElement("menuitem");
    item.id = ITEM_ID;
    item.setAttribute("label", "Umbra Source (SecureDrop)");
    item.addEventListener("command", () => win.openTrustedLinkIn(SOURCE_URL, "tab"));
    const privacy = doc.getElementById("umbra-privacy-menuitem");
    popup.insertBefore(item, privacy ? privacy.nextSibling : doc.getElementById("menu_pageInfo"));
  } catch (e) {
    console.error("UmbraSource:", e);
  }
}

export const UmbraSource = {
  init() {
    if (initialized) {
      return;
    }
    initialized = true;
    if (Services.prefs.getBoolPref("umbra.source.mode", false)) {
      // Inside the Source instance itself: no menu entry needed.
      return;
    }
    Services.obs.addObserver(w => decorate(w), "browser-delayed-startup-finished");
    for (const w of Services.wm.getEnumerator("navigator:browser")) {
      decorate(w);
    }
  },
  launch,
  launchPlan,
  prepareProfile,
  sourceProfileDir,
  isAllowedTarget,
};
