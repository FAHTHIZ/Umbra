// Adds "Umbra Privacy" to the Tools menu of every browser window.
// Registered via components.manifest at browser-first-window-ready.
export const PRIVACY_URL = "chrome://browser/content/umbra-privacy/privacy.html";
const ITEM_ID = "umbra-privacy-menuitem";
let initialized = false;

function open(win) {
  win.openTrustedLinkIn(PRIVACY_URL, "tab");
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
    item.setAttribute("label", "Umbra Privacy");
    item.setAttribute("accesskey", "U");
    item.addEventListener("command", () => open(win));
    const anchor = doc.getElementById("menu_pageInfo");
    popup.insertBefore(item, anchor || null);
  } catch (e) {
    console.error("UmbraPrivacy:", e);
  }
}

const observer = {
  observe(subject, topic) {
    if (topic === "browser-delayed-startup-finished") {
      decorate(subject);
    }
  },
};

export const UmbraPrivacy = {
  init() {
    if (initialized) {
      return;
    }
    initialized = true;
    Services.obs.addObserver(observer, "browser-delayed-startup-finished");
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      decorate(win);
    }
  },
  open() {
    const win = Services.wm.getMostRecentWindow("navigator:browser");
    if (win) {
      open(win);
    }
  },
  get initialized() {
    return initialized;
  },
};
