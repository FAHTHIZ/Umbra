# Idea intake

Every new idea from the product owner or a contributor gets an entry here before it's implemented.

Template:

```
## <title>  (status: proposed | approved | rejected | done)
Requested by: … · Date: …
Feasibility: …
Architectural consequences: …
Security / privacy implications: … (does it change anything a website can observe?)
Performance implications: …
Decision: …  (owner)
Implementation: commits / PR / tests
```

---

## Ship enterprise policies.json for hardening  (status: rejected)
Date: 2026-11-12
Feasibility: Trivial.
Security implications: Any active enterprise policy makes Firefox set `dom.webserial.enabled=false`. That makes `navigator.serial` absent and separates Umbra users from the Tor Browser crowd. Caught by `tests/integration/test_parity.py`.
Decision: Rejected. Updates are disabled through the anchored patch `umbra-update-disable` instead.

## Ordinary (non-Tor) browsing mode  (status: proposed)
Feasibility: Needs a separate profile and process tree. Mixing it with Tor browsing in one profile is unsafe (shared caches and history).
Security implications: A high risk of user confusion. It needs a strong visual distinction and must never share storage with Tor browsing.
Decision: Waiting for the owner's decision.

## Umbra Access Engine (status: approved, integration in progress)
Requested by: owner (commits 85e43f0, bce5c0e, 2087cf7) · Date: 2026-11-12
Feasibility: High. Native parent-process module, content frame script and chrome dashboard. The build pipeline now packages the modules and registers the first-window startup category. Unit tests cover packaging; browser-level verification remains outstanding.
Architectural consequences: `overlay/access/` is packaged into browser omni.ja at `modules/umbra/` and `chrome/browser/content/umbra-access/`; BrowserComponents.manifest registers `UmbraAccessEngine.init`. A toolbar button opens the local dashboard.
Security / privacy implications: **Web-observable when filtering or cosmetic cleanup is enabled.** Blocking third-party requests and DOM changes can make users more distinguishable. Therefore page inspection is on by default, while network filtering and cosmetic cleanup default off. The frame script runs in the content process and only reports bounded classifications; no URL, onion hostname, page text or form values are sent to browser chrome.
Performance implications: Positive on ad-heavy pages (fewer requests), small per-request overhead.
Engineering decision: Implemented with privacy-preserving defaults: `umbra.access.enabled=false` and `umbra.access.cosmetic=false`. The dashboard warns that enabling either can affect fingerprintability. No paywall, authentication or payment authorization bypass is included. Run parity and leak tests in both states before release.
Decision: Approved by owner on 2026-11-12. Continue integration and verification; do not mark production-ready until the acceptance tests in `docs/UMBRA_ACCESS_ENGINE.md` pass.

## Local LLM for Umbra Assistant

- **Feasibility:** Firefox ESR 153 has the ML inference engine, but Tor Browser disables it (`browser.ml.enable=false`), and models are normally fetched at runtime from Remote Settings.
- **Architecture:** it would need a pinned model bundled in the release, loaded only from disk, with no Remote Settings.
- **Security and privacy:** runtime downloads and per-user model state are fingerprintable. A bundled, identical model avoids that, but the parity suite must prove it.
- **Performance:** it adds hundreds of MB of download, plus memory and CPU per run. A low-end hardware budget would need to be set.
- **Decision:** not shipped. The Assistant ships model-free (extractive) instead. **Owner decision needed** on whether a bundled model is worth the size.
