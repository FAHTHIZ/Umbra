// Umbra Assistant: local page analysis (no model, no network).
// Tor Browser disables Firefox's ML engine and translations (browser.ml.enable=false);
// Umbra keeps them disabled. See docs/modules/ASSISTANT.md.
export const ASSISTANT_URL = "chrome://browser/content/umbra-assistant/assistant.html";
const ITEM_ID = "umbra-assistant-menuitem";
let initialized = false;
let last = null;

function registerActor() {
  try {
    ChromeUtils.registerWindowActor("UmbraAssistant", {
      child: { esModuleURI: "resource:///modules/umbra/UmbraAssistantChild.sys.mjs" },
      matches: ["http://*/*", "https://*/*", "file:///*"],
      allFrames: false,
    });
  } catch (e) {
    if (!String(e).includes("NotSupportedError")) throw e; // already registered
  }
}

/** Extract from a <browser>'s top document via the content actor. */
export async function extract(browser) {
  const wg = browser.browsingContext?.currentWindowGlobal;
  if (!wg) throw new Error("This page can't be analysed.");
  let actor;
  try {
    actor = wg.getActor("UmbraAssistant");
  } catch (_) {
    throw new Error("Umbra Assistant works on web pages (http, https and onion sites).");
  }
  return actor.sendQuery("UmbraAssistant:Extract");
}

export function lastExtraction() {
  return last;
}

export async function analyzeTab(win, tab = win.gBrowser.selectedTab) {
  last = { pending: true, url: tab.linkedBrowser.currentURI?.spec };
  try {
    last = await extract(tab.linkedBrowser);
  } catch (e) {
    last = { error: e.message || String(e), url: tab.linkedBrowser.currentURI?.spec };
  }
  return last;
}

async function open(win) {
  const source = win.gBrowser.selectedTab;
  await analyzeTab(win, source);
  win.gBrowser.addTrustedTab(ASSISTANT_URL, { relatedToCurrent: true, inBackground: false });
}

function decorate(win) {
  try {
    const doc = win.document;
    if (doc.getElementById(ITEM_ID)) return;
    const popup = doc.getElementById("menu_ToolsPopup");
    if (!popup) return;
    const item = doc.createXULElement("menuitem");
    item.id = ITEM_ID;
    item.setAttribute("label", "Umbra Assistant: summarise this page");
    item.addEventListener("command", () => open(win));
    const after = doc.getElementById("umbra-desk-menuitem") || doc.getElementById("umbra-privacy-menuitem");
    popup.insertBefore(item, after ? after.nextSibling : doc.getElementById("menu_pageInfo"));
  } catch (e) {
    console.error("UmbraAssistant:", e);
  }
}

export const UmbraAssistant = {
  init() {
    if (initialized) return;
    initialized = true;
    if (Services.prefs.getBoolPref("umbra.source.mode", false)) return;
    registerActor();
    Services.obs.addObserver(w => decorate(w), "browser-delayed-startup-finished");
    for (const w of Services.wm.getEnumerator("navigator:browser")) decorate(w);
  },
  extract, analyzeTab, lastExtraction, open,
};
