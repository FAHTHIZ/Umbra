// "Umbra" toolbar button: one place to reach every Umbra module.
// (Firefox hides the menu bar by default, so the Tools menu entries alone are hard to find.)
const WIDGET_ID = "umbra-menu-button";
const PLACED_PREF = "umbra.menu.toolbarPlaced";
let initialized = false;

export const ITEMS = [
  { id: "privacy", label: "Privacy dashboard", url: "chrome://browser/content/umbra-privacy/privacy.html" },
  { id: "desk", label: "Desk: research notes", url: "chrome://browser/content/umbra-desk/desk.html" },
  { id: "assistant", label: "Assistant: summarise this page", action: "assistant" },
  { id: "vault", label: "Vault: encrypted export", url: "chrome://browser/content/umbra-vault/vault.html" },
  { id: "source", label: "Source: contact journalists (SecureDrop)", url: "chrome://browser/content/umbra-source/source.html" },
  { id: "investigate", label: "Investigate: onion-only evidence browser", url: "chrome://browser/content/umbra-investigate/investigate.html" },
  { id: "access", label: "Access Engine", url: "chrome://browser/content/umbra-access/dashboard.html" },
  { sep: true },
  { id: "newidentity", label: "New Identity (close and forget)", command: "cmd_newIdentity" },
];

function run(win, item) {
  if (item.action === "assistant") {
    const { UmbraAssistant } = ChromeUtils.importESModule("resource:///modules/umbra/UmbraAssistant.sys.mjs");
    return UmbraAssistant.open(win);
  }
  if (item.command) {
    return win.document.getElementById(item.command)?.doCommand();
  }
  return win.openTrustedLinkIn(item.url, "tab");
}

function build(doc) {
  const win = doc.defaultView;
  const button = doc.createXULElement("toolbarbutton");
  button.id = WIDGET_ID;
  button.className = "toolbarbutton-1 chromeclass-toolbar-additional";
  button.setAttribute("type", "menu");
  button.setAttribute("label", "Umbra");
  button.setAttribute("tooltiptext", "Umbra: privacy, Desk, Assistant, Vault, Source");
  button.style.listStyleImage = "url(chrome://branding/content/icon32.png)";
  const popup = doc.createXULElement("menupopup");
  popup.id = WIDGET_ID + "-popup";
  for (const item of ITEMS) {
    if (item.sep) {
      popup.append(doc.createXULElement("menuseparator"));
      continue;
    }
    const mi = doc.createXULElement("menuitem");
    mi.id = `umbra-menu-${item.id}`;
    mi.setAttribute("label", item.label);
    mi.addEventListener("command", () => run(win, item));
    popup.append(mi);
  }
  button.append(popup);
  return button;
}

export const UmbraMenu = {
  init() {
    if (initialized) return;
    initialized = true;
    if (Services.prefs.getBoolPref("umbra.source.mode", false)) return;
    try {
      const { CustomizableUI: C } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs");
      if (C.getWidget(WIDGET_ID)?.provider !== C.PROVIDER_API) {
        C.createWidget({ id: WIDGET_ID, type: "custom", defaultArea: C.AREA_NAVBAR, onBuild: build });
      }
      // Tor Browser ships a saved layout: place once, then respect the user's customisation.
      if (!Services.prefs.getBoolPref(PLACED_PREF, false)) {
        if (!C.getPlacementOfWidget(WIDGET_ID)) {
          const anchor = C.getPlacementOfWidget("new-identity-button");
          C.addWidgetToArea(WIDGET_ID, C.AREA_NAVBAR, anchor?.area === C.AREA_NAVBAR ? anchor.position : undefined);
        }
        Services.prefs.setBoolPref(PLACED_PREF, true);
      }
    } catch (e) {
      console.error("UmbraMenu:", e);
    }
  },
  ITEMS,
};
