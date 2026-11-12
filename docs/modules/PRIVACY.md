# Umbra Privacy (dashboard, planned)

Goal: one local page (`about:umbra`) that shows the protections in effect, explains them in plain language, and links to the controls.

| Panel | Data source (local only) |
|---|---|
| Tor status, circuit for current site | TorConnect, TorDomainIsolator |
| Security level | `browser.security_level.security_slider` |
| Fingerprinting protection | RFP state (read-only; it's never configurable) |
| HTTPS-Only, history mode, clear-on-exit | prefs |
| Search provider and who sees your queries | SearchService |

Constraints: chrome-privileged page with strict CSP, no network, and **read-mostly**. Any toggle that changes fingerprinting is excluded by design.
