// Umbra release notice.
//
// Tor Browser's MAR updater is disabled in Umbra (it would install stock Tor
// Browser), so without this users would silently miss security releases.
// Behaviour mirrors upstream's own update ping, but it is smaller:
//   - at most once per 24 h, only after Tor has bootstrapped
//   - one anonymous GET over Tor (SOCKS, remote DNS), no cookies, no identifiers
//   - only `tag_name` is read; the notification links to a fixed URL
//   - never downloads or installs anything
// Disable: umbra.update.notify = false.
import { evaluateRelease } from "resource:///modules/umbra/update-version.mjs";
import { clearTimeout, setTimeout } from "resource://gre/modules/Timer.sys.mjs";

const PREF_NOTIFY = "umbra.update.notify";
const PREF_URL = "umbra.update.url";
const PREF_LAST = "umbra.update.lastCheck";
const PREF_SEEN = "umbra.update.dismissed";
const DAY = 24 * 60 * 60;
const STARTUP_DELAY_MS = 60 * 1000;
const NOTIFICATION_ID = "umbra-update-available";

let initialized = false;
let timer = null;
let available = null;

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  TorConnect: "moz-src:///toolkit/modules/TorConnect.sys.mjs",
});

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function torReady() {
  try {
    // TorConnect.enabled is false when Tor is managed externally (system tor, Tails):
    // traffic still goes to the SOCKS proxy, so checking is fine.
    return !lazy.TorConnect.enabled || lazy.TorConnect.stageName === "Bootstrapped";
  } catch (_) {
    return false;
  }
}

async function fetchLatest() {
  const url = Services.prefs.getStringPref(PREF_URL, "https://api.github.com/repos/FAHTHIZ/Umbra/releases/latest");
  const res = await fetch(url, {
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }
  return res.json();
}

function notifyWindow(win) {
  if (!available || !win?.gNotificationBox) {
    return;
  }
  if (Services.prefs.getStringPref(PREF_SEEN, "") === available.version) {
    return;
  }
  const box = win.gNotificationBox;
  if (box.getNotificationWithValue(NOTIFICATION_ID)) {
    return;
  }
  const { version, url } = available;
  box.appendNotification(
    NOTIFICATION_ID,
    {
      label: `Umbra ${version} is available. Updates include Tor Browser security fixes.`,
      priority: box.PRIORITY_WARNING_MEDIUM,
      eventCallback(event) {
        if (event === "dismissed") {
          Services.prefs.setStringPref(PREF_SEEN, version);
        }
      },
    },
    [
      {
        label: "Get the update",
        accessKey: "G",
        callback() {
          win.openTrustedLinkIn(url, "tab");
        },
      },
    ]
  );
}

export const UmbraUpdateNotice = {
  init() {
    if (initialized) {
      return;
    }
    initialized = true;
    if (!Services.prefs.getBoolPref(PREF_NOTIFY, true)) {
      return;
    }
    timer = setTimeout(() => this.maybeCheck(), STARTUP_DELAY_MS);
    Services.obs.addObserver(win => notifyWindow(win), "browser-delayed-startup-finished");
  },

  async maybeCheck() {
    if (!Services.prefs.getBoolPref(PREF_NOTIFY, true) || !torReady()) {
      return null;
    }
    if (nowSec() - Services.prefs.getIntPref(PREF_LAST, 0) < DAY) {
      return available;
    }
    return this.checkNow();
  },

  /** Force a check (used by tests and the Privacy dashboard). */
  async checkNow() {
    try {
      const json = await fetchLatest();
      Services.prefs.setIntPref(PREF_LAST, nowSec());
      const current = Services.prefs.getStringPref("umbra.version", "0.0.0");
      available = evaluateRelease(json, current);
      if (available) {
        for (const win of Services.wm.getEnumerator("navigator:browser")) {
          notifyWindow(win);
        }
      }
    } catch (e) {
      // Offline / rate-limited: stay quiet, retry next startup.
      console.warn("Umbra update check failed:", e.message);
    }
    return available;
  },

  get available() {
    return available;
  },

  uninit() {
    clearTimeout(timer);
  },
};
