// Umbra Desk: a research workspace that leaves nothing behind.
// Notes live only in this process's memory: never written to disk, gone on restart,
// and cleared on New Identity. Fingerprint-neutral (no web-exposed API, chrome-only page).
export const DESK_URL = "chrome://browser/content/umbra-desk/desk.html";
const ITEM_ID = "umbra-desk-menuitem";
let initialized = false;
let notes = "";
const listeners = new Set();

function notify() {
  for (const l of listeners) {
    try {
      l(notes);
    } catch (_) {}
  }
}

export function getNotes() {
  return notes;
}

export function setNotes(text) {
  notes = String(text ?? "").slice(0, 200000);
  notify();
}

export function clearNotes() {
  notes = "";
  notify();
}

export function onNotes(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Open tabs across all normal browser windows. */
export function openTabs() {
  const out = [];
  for (const w of Services.wm.getEnumerator("navigator:browser")) {
    for (const tab of w.gBrowser.tabs) {
      const b = tab.linkedBrowser;
      out.push({ url: b.currentURI?.spec || "", title: tab.label || "" });
    }
  }
  return out.filter(t => t.url && !t.url.startsWith("chrome://browser/content/umbra-desk/"));
}

/** Upstream Tor Browser "New Identity": closes everything, clears state, new circuits. */
export function closeAndForget(win) {
  clearNotes();
  win.document.getElementById("cmd_newIdentity")?.doCommand();
}

function decorate(win) {
  try {
    const doc = win.document;
    if (doc.getElementById(ITEM_ID)) return;
    const popup = doc.getElementById("menu_ToolsPopup");
    if (!popup) return;
    const item = doc.createXULElement("menuitem");
    item.id = ITEM_ID;
    item.setAttribute("label", "Umbra Desk (research notes)");
    item.addEventListener("command", () => win.openTrustedLinkIn(DESK_URL, "tab"));
    const after = doc.getElementById("umbra-vault-menuitem") || doc.getElementById("umbra-privacy-menuitem");
    popup.insertBefore(item, after ? after.nextSibling : doc.getElementById("menu_pageInfo"));
  } catch (e) {
    console.error("UmbraDesk:", e);
  }
}

export const UmbraDesk = {
  init() {
    if (initialized) return;
    initialized = true;
    Services.obs.addObserver(() => clearNotes(), "new-identity-requested");
    Services.obs.addObserver(w => decorate(w), "browser-delayed-startup-finished");
    for (const w of Services.wm.getEnumerator("navigator:browser")) decorate(w);
  },
  getNotes, setNotes, clearNotes, onNotes, openTabs, closeAndForget,
};
