# Umbra Privacy dashboard

Status: ✅ v1. Open it from **Tools → Umbra Privacy**, or at `chrome://browser/content/umbra-privacy/privacy.html`.

A local, read-only page that shows which protections are in effect, explains each one in plain language, and links to the controls. It updates live when a pref or the Tor connection changes.

| Group | Checks | Source |
|---|---|---|
| Network | Tor connection stage; SOCKS proxy plus remote DNS; per-site circuits | TorConnect, `network.proxy.*`, `extensions.torbutton.use_nontor_proxy` |
| Fingerprinting & security | RFP, letterboxing, WebRTC, security level (custom = review), HTTPS-Only | prefs, SecurityLevelPrefs |
| Your data | permanent private browsing, no telemetry, Access Engine filtering (with its fingerprint caveat) | prefs |
| Search | default provider (what it can and can't see), suggestions | SearchService |

Design rules:
- CSP `default-src 'none'; connect-src 'none'`. The page can't make network requests.
- Read-only: there are no toggles for fingerprint-relevant settings, only links to the upstream settings panes.
- It never shows "Fully protected" unless Tor is connected (`Bootstrapped`).
- The logic lives in `overlay/privacy/privacy-checks.mjs` (pure function, unit-tested under Node). The UI is in `privacy.js`, and the Tools menu hook is `UmbraPrivacy.sys.mjs`.

Tests: `tests/umbra/privacy-checks.test.mjs`, `tests/integration/test_privacy_dashboard.py`.
