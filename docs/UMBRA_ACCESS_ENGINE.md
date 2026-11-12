# Umbra Access Engine

Status: **experimental native integration, packaged by the build pipeline; not yet production-certified**

See [ACCESS_ENGINE_RESEARCH.md](ACCESS_ENGINE_RESEARCH.md) for upstream project, compatibility and licensing decisions.

Umbra Access Engine is an in-browser capability integrated into the existing Tor Browser-based build. It has two distinct modes:

- **Local page inspection:** enabled by default. It reads bounded DOM structure and metadata to identify login/registration interfaces, likely paywalls, checkout UI, cookie dialogs, known payment-provider hosts and suspicious payment-form destinations. It does not read input values, passwords, card numbers, cookies, storage or authentication tokens.
- **Network/cosmetic filtering:** available but disabled by default. Enabling it changes what a website can observe and can make the user more distinguishable from the Tor Browser crowd. The dashboard explains this trade-off.

## Implementation

| File | Responsibility |
|---|---|
| `overlay/access/FilterRules.sys.mjs` | Small local starter set of ad/tracker host rules, onion-host recognition and payment-provider identification |
| `overlay/access/AccessSignals.sys.mjs` | Pure local helpers for payment URI scheme classification and meta-refresh redirect signals |
| `overlay/access/AccessEngine.sys.mjs` | Parent-process request observer, toolbar entry point, in-memory counters, settings and sanitized page-report receiver |
| `overlay/access/content-frame.js` | Bounded top-frame DOM inspection and conservative cosmetic cleanup |
| `overlay/access/dashboard.html` | Local browser-chrome dashboard |
| `overlay/access/dashboard.js` | Dashboard controls and report rendering |
| `overlay/access/dashboard.css` | Local dashboard styling |
| `tools/umbra_build/build.py` | Packages modules and chrome resources into browser omni.ja and registers the startup category |
| `tests/unit/test_build_tools.py` | Verifies Access Engine files are included in the built omni archive and privacy-preserving defaults |
| `tests/umbra/filter-rules.test.mjs` | Tests local rule matching and provider recognition |

## Privacy boundaries

- Page inspection and request classification are local. No page-analysis request, cloud crawler, remote filter-list fetch or telemetry is implemented.
- The report schema contains only booleans, bounded provider labels, bounded indicator codes, overlay counts and an onion boolean. It excludes full URLs, onion hostnames, referrers, page text and form values.
- The current page's URL may be held transiently in browser memory when the user opens the dashboard, solely to support an explicit reader-view action and a temporary per-site exception. It is not persisted or sent to OnionSearch.
- Onion addresses are inspected locally. Onion hostnames are not included in reports or sent to external filtering services.
- OnionSearch receives only a query explicitly typed and submitted by the user. The current page address and contents are never appended.
- Cookie dialogs are detected, never automatically accepted or rejected.
- Login, registration, paywall and checkout detection is heuristic and can be wrong.
- Payment-provider recognition identifies known hostnames; it does not authenticate merchants, authorize payments or prove that a destination is safe.
- Crypto-payment link inspection records only a recognized URI scheme (`bitcoin`, `ethereum`, `lightning`, `monero`); it never retains or reports the address.
- Redirect inspection currently analyzes HTML `meta refresh` targets for cross-origin changes, HTTP downgrade, credential-bearing URLs, IP-literal destinations and non-web schemes. It does not cover every HTTP 3xx or JavaScript-driven redirect.
- Suspicious checkout indicators are warnings, not fraud verdicts.
- No authentication or payment control is bypassed.

## Tor fingerprint trade-off

Blocking third-party resources and modifying the DOM are observable by websites. This is a meaningful fingerprinting trade-off. Therefore:

- Page inspection runs by default because it only observes DOM metadata and sends a bounded report to local browser chrome.
- Network filtering defaults to **off**.
- Cosmetic DOM changes default to **off**.
- Users must explicitly enable network or cosmetic filtering after reading the dashboard warning.
- The upstream Tor Browser security preferences and sandbox settings must remain unchanged.

## Current limitations

- The built-in domain list is a small starter set, not EasyList/EasyPrivacy and not a complete content-blocking engine.
- The engine does not yet parse full ABP/uBlock filter syntax, use scriptlets, or support remotely fetched rule updates. Ghostery Adblocker is the selected candidate for a later pinned MPL-2.0 integration, but is not bundled in this build.
- Cosmetic cleanup recognizes only a narrow set of obvious promotional overlay patterns.
- The reader-view and alternative-source workflow is not a paywall bypass. It only uses content already publicly available or sources the user explicitly searches for.
- The toolbar and dashboard are packaged by the overlay build. Browser smoke tests now cover local page inspection, toolbar registration and dashboard loading; their CI execution and broader UI verification remain outstanding.
- No live onion-site compatibility run has yet been recorded specifically for the Access Engine.
- No security audit has certified this build for high-risk whistleblower use.

## Verification required before production

1. Run the Python unit suite and Node rule tests.
2. Build a fresh Umbra release and verify the Access Engine files and BrowserComponents startup registration inside the artifact.
3. Launch the built browser and verify the toolbar, dashboard, settings, counters, temporary exceptions and reader-view actions.
4. Test ordinary HTTPS and valid v3 onion services using controlled fixtures.
5. Verify that no onion URL, host, referrer, query or page content leaves the local browser process.
6. Re-run the existing SOCKS canary, remote-DNS, direct-socket and fail-closed leak tests with the engine enabled and disabled.
7. Re-run the Tor Browser fingerprint parity suite. The default configuration must remain parity-compatible.
8. Add performance tests on large, mutation-heavy pages and verify that scans are bounded and do not cause navigation delays.
9. Complete an independent security review before recommending Umbra to sources or journalists facing targeted adversaries.

## Run tests

```sh
python -m pytest tests/unit
node --test tests/umbra/*.test.mjs
```
