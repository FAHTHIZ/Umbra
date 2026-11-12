// Umbra preference layer. Loaded after Tor Browser's 000-tor-browser.js.
//
// RULE: Umbra must not change any pref that alters what websites can observe
// (fingerprinting surface, network behaviour, isolation). Changing those would
// make Umbra users distinguishable from the Tor Browser crowd and weaken
// anonymity. tests/unit/test_prefs_policy.py enforces this with a denylist.

// --- Identity -------------------------------------------------------------
pref("umbra.version", "@UMBRA_VERSION@");
pref("umbra.upstream.torbrowser", "@UPSTREAM_VERSION@");

// --- Search (local UI only; not observable by sites) -----------------------
// Default engine comes from the search config (OnionSearch). Suggestions stay
// OFF by default: every keystroke would otherwise be sent to the provider.
pref("browser.search.suggest.enabled", false);
pref("browser.urlbar.suggest.searches", false);
pref("browser.search.separatePrivateDefault", false);
pref("browser.urlbar.showSearchSuggestionsFirst", false);

// --- Updates ----------------------------------------------------------------
// Tor Browser's MAR updater would replace Umbra with stock Tor Browser.
// Umbra ships rebuilt releases (see docs/RELEASE.md); in-app update is disabled
// via policies.json and these URLs point users at Umbra releases.
pref("app.update.url.manual", "https://github.com/FAHTHIZ/Umbra/releases");
pref("app.update.url.details", "https://github.com/FAHTHIZ/Umbra/releases");
pref("app.releaseNotesURL", "https://github.com/FAHTHIZ/Umbra/releases");
pref("app.releaseNotesURL.aboutDialog", "https://github.com/FAHTHIZ/Umbra/releases");
pref("startup.homepage_override_url", "");

// --- Performance (no fingerprinting impact) --------------------------------
// Unload background tabs under memory pressure (Firefox tab unloader).
pref("browser.tabs.unloadOnLowMemory", true);
// Don't eagerly restore every tab of a restored session.
pref("browser.sessionstore.restore_on_demand", true);
pref("browser.sessionstore.restore_pinned_tabs_on_demand", true);

// Read by overlay/patches (umbra-update-disable).
pref("umbra.update.disabled", true);
