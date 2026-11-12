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

## Umbra Access Engine (local ad/tracker blocking + page inspection)  (status: proposed, code landed in `overlay/access/`, not wired into builds)
Requested by: owner (commits 85e43f0, bce5c0e, 2087cf7) · Date: 2026-11-12
Feasibility: High. Parent-process module + frame script; no network, no persistence (good invariants).
Architectural consequences: Needs registration (resource:///modules/umbra/, chrome://browser/content/umbra-access/), a toolbar button and a dashboard page; the build must copy `overlay/access/` into browser/omni.ja and register an observer at startup.
Security / privacy implications: **Web-observable.** Blocking third-party requests is detectable by sites (e.g. a script checks whether `googletagmanager` loaded), which separates Umbra users from the Tor Browser crowd. Tor Browser deliberately ships no ad blocker for this reason ([Tor Browser design](https://2019.www.torproject.org/projects/torbrowser/design/#philosophy)). Frame scripts in content also add attack surface.
Performance implications: Positive on ad-heavy pages (fewer requests), small per-request overhead.
Engineering recommendation: Ship it **off by default** (`umbra.access.enabled=false`), with a clear dashboard note: "Turning this on makes you more distinguishable from other Tor users." The page-inspection part (login/checkout/phishing indicators, no blocking) has no web-visible effect and can default on. Add parity and leak tests for both states before release.
Decision: awaiting owner.
