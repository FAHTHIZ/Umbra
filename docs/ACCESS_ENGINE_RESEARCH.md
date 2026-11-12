# Access Engine technology review

Research snapshot: 2026-11-12. This document records reuse decisions for the native Access Engine. Licensing notes are engineering triage, not legal advice; re-check the exact commit and every transitive dependency before redistribution.

## Recommended filtering foundation

### Ghostery Adblocker — selected candidate for the next filtering milestone

- Source: https://github.com/ghostery/adblocker
- License: MPL-2.0.
- The project describes itself as an efficient embeddable JavaScript/TypeScript engine, supports uBlock Origin- and EasyList-compatible syntax, and can be used as a standalone library rather than requiring a WebExtension.
- Its API exposes `FiltersEngine.parse()`, `Request.fromRawDetails()`, `engine.match()` and `getCosmeticsFilters()`. This is a much better fit for a native Gecko adapter than implementing the ABP/uBO parser from scratch.
- Its published compatibility matrix documents network filter syntax, exceptions, request types and cosmetic filtering.
- The upstream repository showed active development in October 2026.

Links:
- https://github.com/ghostery/adblocker
- https://github.com/ghostery/adblocker/wiki/Compatibility-Matrix
- https://www.npmjs.com/package/@ghostery/adblocker

**Decision:** Adopt Ghostery Adblocker as the preferred candidate after a pinned, reproducible build integration and a Gecko-specific adapter are implemented. Parse only locally vendored or locally updated lists. Do not use its remote-list convenience methods at runtime for onion browsing. Its GPL-licensed scriptlet companion packages must be evaluated separately before inclusion.

## Projects reviewed

| Project | License / maintenance signal | Useful parts | Umbra decision |
|---|---|---|---|
| [uBlock Origin](https://github.com/gorhill/uBlock) | GPL-3.0; actively maintained | Excellent filtering architecture, dynamic rules, scriptlets, cosmetic filtering and mature filter-list ecosystem | Study architecture and rule semantics. Do not copy GPL code into Umbra's MPL-2.0 code without a deliberate licensing decision. |
| [AdGuard Browser Extension](https://github.com/AdguardTeam/AdguardBrowserExtension) | GPL-3.0; active repository | Mature rule processing, scriptlets, cosmetic filtering and browser integration | Study and compare. Avoid copying GPL implementation code into the current project license without resolving distribution obligations. |
| [Ghostery Adblocker](https://github.com/ghostery/adblocker) | MPL-2.0; active, published package | Embeddable parser/matcher, EasyList/uBO syntax compatibility, request matching and cosmetic rules | Preferred engine candidate. Not yet bundled in the current build; current starter host rules remain in place until the adapter is tested. |
| [EasyList](https://github.com/easylist/easylist) / [EasyPrivacy](https://easylist.to/pages/licence.html) | Dual-licensed GPL-3.0-or-later or CC BY-SA 3.0-or-later for the named lists; active community maintenance | High-quality advertising and tracker rules | Vendor pinned snapshots only with attribution, license files, source commit, date and checksums. Avoid live runtime fetches in onion sessions. |
| [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) | Open-source consent automation project | CMP detection and preference-aware consent handling | Study its CMP patterns. Umbra must never fabricate consent or silently accept all cookies; default to detection and explicit user choices. |
| [Hover Paywalls](https://github.com/nang-dev/hover-paywalls-browser-extension) | Deprecated by maintainers | Historical site-specific rules | Do not integrate. |
| [Bypass Paywalls](https://github.com/EdgeN8v/bypass-paywalls) | MIT-licensed repository | Historical site-specific page handling | Do not integrate paywall circumvention. Use only the general lesson that site-specific rules need tests and maintenance. |
| [Frankensurf](https://github.com/yail259/frankensurf) | Apache-2.0 repository | Retrieval orchestration and fallback concepts | Do not run cloud retrieval for current-page analysis. Any future public-source discovery must be user-initiated and must never submit onion URLs or page contents. |
| [zapret](https://github.com/bol-van/zapret) / [zapret2](https://github.com/bol-van/zapret2) | MIT; zapret v1 is end-of-life and zapret2 is its successor | Network-level DPI circumvention | Outside the browser engine. Do not modify Tor packets or route around Tor's proxy policy. |

## Architecture decisions

1. **One filtering engine only.** Do not stack uBlock, AdGuard and Ghostery engines. Duplicate blockers increase CPU cost and create hard-to-debug conflicts.
2. **No remote analysis.** The page inspector and request matcher operate locally. An onion URL must never be submitted to a crawler, cloud model, filter-list service or analytics endpoint.
3. **No remote rule fetch from onion sessions.** Rule updates, if later added, must be explicit, signed/checksummed, and fetched through a separate update flow. A Tor session must never silently leak the current onion host as a ruleset lookup.
4. **Keep filtering opt-in.** Network blocking and cosmetic changes are observable and can split the browser fingerprint from upstream Tor Browser. Page inspection remains read-only and local by default.
5. **No consent forgery.** Identify consent-management platforms and expose choices; never manufacture a consent signal or silently choose "accept all".
6. **No access-control bypass.** Detect authentication and subscription interfaces, identify legitimate payment providers, and find publicly available alternatives. Do not bypass logins, subscriptions, payment authorization or private content.
7. **No secrets in diagnostics.** Never inspect or store input values, card numbers, passwords, cookies, session tokens, or full payment payloads.

## Current implementation gap

The current `overlay/access/FilterRules.sys.mjs` contains a small hand-maintained starter list. The Ghostery engine has not yet been bundled. Before calling filtering mature, the project needs:

- A pinned Ghostery release and complete dependency/license inventory.
- A reproducible Node/Rollup bundle step compatible with the existing Python build.
- A Gecko request adapter mapping Gecko content policy types to Ghostery `Request` types.
- A local, integrity-checked ruleset snapshot with attribution and update metadata.
- Tests for network exceptions, first-party context, redirects, CSP, cosmetic rules, onion requests and fail-closed Tor routing.
- Browser-level performance measurements and fingerprint-parity tests.

Do not mark this milestone complete until the above tests pass.
