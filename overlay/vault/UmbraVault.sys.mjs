// Umbra Vault: encrypted export/import of bookmarks and saved logins.
// Collection and restore happen here (privileged). Encryption happens in the Vault page via
// WebCrypto (vault-crypto.mjs). Nothing leaves the device: no network, no sync.
const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

export const VAULT_URL = "chrome://browser/content/umbra-vault/vault.html";
const ITEM_ID = "umbra-vault-menuitem";
let initialized = false;

const LOGIN_FIELDS = ["origin", "formActionOrigin", "httpRealm", "username", "password", "usernameField", "passwordField"];

async function bookmarksTree() {
  const P = lazy.PlacesUtils;
  return P.promiseBookmarksTree(P.bookmarks.rootGuid, { includeItemIds: false });
}

/**
 * Saved logins need NSS's key database. Tor Browser (and so Umbra) runs with
 * security.nocertdb=true and signon.rememberSignons=false by default, so no
 * logins exist and none can be stored. Vault never changes those prefs.
 */
export function loginsAvailable() {
  return !Services.prefs.getBoolPref("security.nocertdb", false);
}

/** Gather the payload. includeLogins requires the primary password if one is set (upstream prompts). */
export async function collect({ bookmarks = true, logins = true } = {}) {
  const payload = { kind: "umbra-vault-payload", schema: 1, created: new Date().toISOString().slice(0, 10), bookmarks: null, logins: [] };
  if (bookmarks) {
    payload.bookmarksRaw = await bookmarksTree();
  }
  if (logins && loginsAvailable()) {
    const all = await Services.logins.getAllLogins();
    payload.logins = all.map(l => Object.fromEntries(LOGIN_FIELDS.map(f => [f, l[f] ?? null])));
  }
  return payload;
}

async function insertTree(parentGuid, node) {
  const P = lazy.PlacesUtils;
  const conv = n => (n.url ? { title: n.title, url: n.url } : { title: n.title, type: P.bookmarks.TYPE_FOLDER, children: n.children.map(conv) });
  const folder = await P.bookmarks.insert({ parentGuid, type: P.bookmarks.TYPE_FOLDER, title: node.title });
  if (node.children.length) {
    await P.bookmarks.insertTree({ guid: folder.guid, children: node.children.map(conv) });
  }
  return folder.guid;
}

/** Restore a validated payload. Bookmarks go into a new folder; duplicate logins are skipped. */
export async function restore(payload) {
  const P = lazy.PlacesUtils;
  const result = { bookmarks: 0, logins: 0, folder: null };
  if (payload.bookmarks) {
    const count = n => (n.url ? 1 : n.children.reduce((a, c) => a + count(c), 0));
    result.folder = await insertTree(P.bookmarks.unfiledGuid, {
      title: `Umbra Vault import (${payload.created || "unknown date"})`,
      children: payload.bookmarks.children || [payload.bookmarks],
    });
    result.bookmarks = count(payload.bookmarks);
  }
  result.loginsSkipped = 0;
  if (payload.logins.length && !loginsAvailable()) {
    result.loginsSkipped = payload.logins.length;
  } else if (payload.logins.length) {
    const infos = payload.logins.map(l => {
      const i = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(Ci.nsILoginInfo);
      i.init(l.origin, l.formActionOrigin ?? null, l.httpRealm ?? null, l.username ?? "", l.password,
        l.usernameField ?? "", l.passwordField ?? "");
      return i;
    });
    const before = (await Services.logins.getAllLogins()).length;
    await Services.logins.addLogins(infos);
    result.logins = (await Services.logins.getAllLogins()).length - before;
  }
  return result;
}

export async function writeFile(path, text) {
  await IOUtils.writeUTF8(path, text, { mode: "create", tmpPath: path + ".tmp" });
  try {
    await IOUtils.setPermissions(path, 0o600);
  } catch (_) {}
  return path;
}

export function readFile(path) {
  return IOUtils.readUTF8(path);
}

function picker(win, mode, title) {
  return new Promise(resolve => {
    const fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(win.browsingContext, title, mode);
    fp.appendFilter("Umbra Vault", "*.umbravault");
    fp.appendFilters(Ci.nsIFilePicker.filterAll);
    if (mode === Ci.nsIFilePicker.modeSave) {
      fp.defaultString = `umbra-vault-${new Date().toISOString().slice(0, 10)}.umbravault`;
    }
    fp.open(r => resolve(r === Ci.nsIFilePicker.returnCancel ? null : fp.file.path));
  });
}

export function pickSave(win) {
  return picker(win, Ci.nsIFilePicker.modeSave, "Save Umbra Vault file");
}

export function pickOpen(win) {
  return picker(win, Ci.nsIFilePicker.modeOpen, "Open Umbra Vault file");
}

function decorate(win) {
  try {
    const doc = win.document;
    if (doc.getElementById(ITEM_ID)) return;
    const popup = doc.getElementById("menu_ToolsPopup");
    if (!popup) return;
    const item = doc.createXULElement("menuitem");
    item.id = ITEM_ID;
    item.setAttribute("label", "Umbra Vault (encrypted export)");
    item.addEventListener("command", () => win.openTrustedLinkIn(VAULT_URL, "tab"));
    const after = doc.getElementById("umbra-source-menuitem") || doc.getElementById("umbra-privacy-menuitem");
    popup.insertBefore(item, after ? after.nextSibling : doc.getElementById("menu_pageInfo"));
  } catch (e) {
    console.error("UmbraVault:", e);
  }
}

export const UmbraVault = {
  init() {
    if (initialized) return;
    initialized = true;
    if (Services.prefs.getBoolPref("umbra.source.mode", false)) return;
    Services.obs.addObserver(w => decorate(w), "browser-delayed-startup-finished");
    for (const w of Services.wm.getEnumerator("navigator:browser")) decorate(w);
  },
  collect, restore, loginsAvailable, writeFile, readFile, pickSave, pickOpen,
};
