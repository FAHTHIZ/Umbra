/*
 * Browser startup adapter. Import and call registerUmbraAccessEngine() from
 * the browser's privileged startup path (e.g. BrowserGlue startup). This is
 * not a WebExtension and does not inject a remote script.
 */

import { Services } from "resource://gre/modules/Services.sys.mjs";
import { UmbraAccessEngine } from "resource:///modules/umbra/AccessEngine.sys.mjs";

let registered = false;

export function registerUmbraAccessEngine() {
  if (registered) return;
  ChromeUtils.registerWindowActor("UmbraAccess", {
    parent: {
      esModuleURI: "resource:///modules/umbra/UmbraAccessParent.sys.mjs"
    },
    child: {
      esModuleURI: "resource:///modules/umbra/UmbraAccessChild.sys.mjs",
      events: {
        DOMContentLoaded: { capture: true },
        pageshow: { capture: true }
      }
    },
    allFrames: false,
    includeChrome: false,
    matches: ["http://*/*", "https://*/*"]
  });

  UmbraAccessEngine.start();
  registered = true;
}

export function unregisterUmbraAccessEngine() {
  if (!registered) return;
  UmbraAccessEngine.stop();
  try { ChromeUtils.unregisterWindowActor("UmbraAccess"); } catch (_) {}
  registered = false;
}
