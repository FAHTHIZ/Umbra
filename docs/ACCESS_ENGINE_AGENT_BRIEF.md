# Umbra Access Engine — priority implementation brief

Status: **agent handoff / implementation required**  
Priority: **core browser capability**  
Applies to: existing `overlay/access/` engine; extend it, do not create a competing engine.

## Product purpose: why Umbra needs this

Umbra is intended to make browsing feel direct and usable without sacrificing Tor's privacy model or breaking onion services. The Access Engine should remove avoidable web friction: advertising and tracker requests, intrusive overlays, cookie-consent nagging, deceptive redirects, and confusing access/payment interfaces. It should also explain what kind of restriction a page is presenting and provide safe, legitimate next steps.

The intended experience is: open a page and continue using it, without waiting for a remote analysis service or manually dismissing a succession of nuisance elements. This is not a promise that every site can be accessed without its owner's authorization. Login, MFA, subscription entitlements, payment authorization and DRM remain the site's access controls; detect and explain them, do not defeat them.

This matters especially for onion services. Many have unusual layouts, minimal resources, custom authentication, payment flows, nonstandard scripts and no advertising/cookie infrastructure at all. A generic web-cleanup rule can break them. Umbra must therefore be conservative, context-aware, reversible and tested against controlled v3 onion fixtures.

## Required feature coverage

Implement each capability as a separately configurable module. Detection must be independent from enforcement: recognizing a feature must not automatically block, click, redirect or rewrite it.

| Capability | Required behavior | Default |
|---|---|---:|
| Ad filtering | Match local, pinned ad rules and block eligible subresource requests | Off |
| Tracker filtering | Match local, pinned tracker rules; respect exceptions and first-party context | Off |
| Cosmetic filtering | Hide only matched ad/annoyance elements; never broadly remove forms, navigation or controls | Off |
| Annoyance filtering | Optional reviewed rules for overlays, popups and intrusive widgets | Off |
| Cookie/CMP detection | Identify known consent managers locally and expose a clear status | On |
| Cookie choice | Offer reject-optional/necessary-only action only for a confidently recognized CMP | Manual by default |
| Login-wall detection | Identify sign-in requirements; preserve the login flow | On |
| Registration-wall detection | Identify account-creation requirements; preserve registration | On |
| MFA/auth challenge detection | Recognize challenge interfaces without reading codes or credentials | On |
| Paywall/subscription detection | Identify preview limits and subscription gates; explain the restriction | On |
| Checkout detection | Identify checkout/payment interfaces without touching payment fields | On |
| Payment-provider recognition | Recognize known provider origins as an informational signal, never a trust verdict | On |
| Payment-destination warnings | Warn on concrete unsafe/mismatched destinations (HTTP downgrade, malformed URL, unexpected origin, IP literal, unsupported scheme) | On |
| Redirect inspection | Inspect observed redirects locally for downgrade, credential-bearing URL, unexpected scheme/origin and suspicious chains | On |
| Public alternatives | Let the user explicitly search a typed query through the existing OnionSearch workflow | On |
| Site exceptions | Allow temporary per-site disable/allow controls, with onion-safe defaults | On |

All switches already enumerated in `docs/ACCESS_ENGINE_INTEGRATION_PLAN.md` must appear in both Umbra Settings and the Access Engine dashboard. Add any new switches for MFA detection and site exceptions with documented preference names. Keep detection toggles separate from blocking/action toggles.

## Fast path: performance is a design requirement

The engine must not make page navigation wait for a remote decision.

1. **No network dependency in the decision path.** Load a pinned local ruleset and local CMP rules. No cloud scanning, remote filter-list fetch, telemetry, external page analysis or online reputation lookup during navigation.
2. **Precompile once.** Build/parse Ghostery filter data at build time where practical, or initialize it once at startup and persist a versioned local serialized representation. Do not parse large text lists on every navigation.
3. **Memory-resident matching.** Keep the compiled matcher hot in memory. Use Ghostery's indexed matcher; do not iterate through every rule for each request.
4. **Cheap classification first.** Use Gecko request type, channel metadata and cached host/domain classification. Avoid repeated URL parsing and repeated domain-suffix work.
5. **Cache safe decisions.** Cache deterministic match outcomes using a bounded cache keyed by the minimum necessary request attributes. Clear/invalidate on ruleset or preference changes. Do not persist browsing history or onion hostnames.
6. **No synchronous DOM crawling.** Run bounded, debounced, incremental inspection after document readiness. Use mutation observers only with strict budgets and disconnect when no longer needed. Never scan every node on every mutation.
7. **No heavy page scripts.** Do not inject generic scriptlets into pages. Keep cosmetic styles separately opt-in; use narrowly scoped selectors.
8. **Fail open for compatibility.** If parsing, classification or matching errors, allow the request and record only a sanitized local diagnostic code. Never hang a channel or delay top-level navigation.
9. **Measure, don't advertise guesses.** Add microbenchmarks for cold initialization, warm matching, cache hits/misses, large rulesets and mutation-heavy pages. Report p50/p95/p99, memory and navigation impact on reference hardware. Do not promise a universal millisecond number before measuring.
10. **Performance budgets.** Target sub-millisecond warm request decisions on reference desktop hardware, with no synchronous work on the top-level navigation path. Set and enforce measured regression budgets in CI. DOM inspection must be chunked and bounded so it cannot cause a long task.

Ghostery's published historical benchmark reported very low median matching times in its test setup, but that is not a guarantee for Umbra/Gecko, the selected pin, all hardware or a full local ruleset. Benchmark the actual integration before claiming speed.

## Onion and ordinary-site compatibility contract

- Never block a top-level document navigation by default.
- Never blanket-block JavaScript, forms, XHR/fetch, WebSocket, images, CSS, fonts, redirects or third-party resources. Apply only a matching, enabled, reviewed rule and honor exception filters.
- Do not assume an onion site is an ad-supported commercial website. Onion hostnames and their content must not be sent to remote services or added to telemetry.
- For `.onion` origins, disable generic cosmetic rules and generic annoyance rules by default. Require explicit user opt-in for any onion cosmetic changes; keep per-site emergency disable available.
- Do not inject a remote script, remote stylesheet, analytics beacon, font or update request into an onion page.
- Preserve Tor Browser's anti-fingerprinting preferences, circuit isolation, proxy routing, DNS protections and security settings.
- Do not alter Tor transport, bridge behavior or circuit selection to make the Access Engine work.
- If the page's purpose or a control's purpose is ambiguous, leave it untouched.
- Every enforcement action must be reversible through a visible per-site control and global switch.
- A controlled v3 onion fixture must cover login, registration, JavaScript-dependent navigation, custom forms, redirects and a minimal page with no ads/CMP.

## Consent behavior

Reuse Consent-O-Matic's MIT-licensed CMP rule data and the minimum required evaluator, adapted to Umbra's Gecko chrome/content architecture. Do not load its browser-extension manifest/background APIs as a drop-in.

- Detect first; show the detected CMP and available choices.
- Auto-reject optional categories only after the user explicitly enables that setting.
- Never auto-accept all, fabricate consent, write CMP cookies directly or click an ambiguous control.
- If recognition confidence is insufficient, leave the site's dialog untouched.
- Treat necessary/essential categories conservatively and preserve the user's explicit preference.

## Access, payment and redirect safety

The engine may identify sign-in, registration, MFA, paywall, checkout and provider interfaces. It may warn about insecure form destinations and suspicious redirects. It must not:
- bypass login, MFA, account checks, subscription entitlements, paywalls, payment authorization or DRM;
- extract, inspect, log or transmit passwords, OTPs, recovery codes, card numbers, CVVs, cookies, storage, authorization headers, tokens or payment payloads;
- auto-submit checkout/payment forms or manipulate payment fields;
- automatically redirect restricted pages to archive/mirror services;
- claim that provider recognition proves a merchant is trustworthy.

Keep reports to bounded categories and indicator codes. Never store full URLs, onion hostnames, page text, form actions, merchant identifiers or credential-bearing data.

## Upstream source handling: fork vs pin

The current repository contains two pinned upstream Git submodules:
- Ghostery Adblocker: `vendor/ghostery-adblocker`, commit `6f0610bf5eec1f31c4975ce0e707cdf47023e5b5`, MPL-2.0.
- Consent-O-Matic: `vendor/consent-o-matic`, commit `8ca8500d26434c586039e126ad091e1bfccd205d`, MIT.

These are reproducible upstream source references, **not GitHub forks owned by FAHTHIZ**. The current GitHub integration used for this work does not expose a fork-creation operation. Do not mislabel submodules as forks. Keep the upstream pins unless the maintainer explicitly creates and approves maintained forks; if forks are later created, preserve upstream attribution, license files, exact source history and a documented sync strategy.

Do not stack multiple full adblock engines. Ghostery is the selected filter engine; Consent-O-Matic is the selected CMP rule source. Additional projects should be added only when they provide a distinct, mature capability and pass licensing, privacy, Gecko-compatibility and onion-safety review.

## Required integration sequence

1. Re-read current `overlay/access/` implementation and preferences; preserve existing semantics and migrate names explicitly.
2. Initialize both submodules in local builds and CI; verify pinned SHAs and license notices.
3. Build a deterministic Ghostery bundle and integrate its standalone matcher into Gecko request observation. Do not import the WebExtension/Electron shells.
4. Add locally pinned, revisioned rulesets with attribution and individual license review. Do not fetch lists while browsing.
5. Add preference wiring and UI controls for every feature; each control must actually affect its corresponding module.
6. Adapt Consent-O-Matic CMP rules and evaluator; detection first, explicit optional rejection only.
7. Expand local access/payment/redirect detectors without reading sensitive field values.
8. Add per-site exceptions, a clear all-off emergency switch and an onion-specific conservative profile.
9. Add unit, integration, performance, fingerprint-parity, leak and controlled onion fixture tests.
10. Update README/checklist/dashboard status only after the feature is built and verified. Never mark pinned source as active functionality.

## Release acceptance gates

- All feature switches are visible and wired; no decorative/inert toggles.
- Ghostery matcher conformance tests pass against selected upstream fixtures.
- Consent tests prove unknown/ambiguous CMPs are untouched and no auto-accept occurs.
- Authentication and payment fixtures prove forms and fields remain functional and untouched.
- Controlled onion fixture passes with all defaults and with each optional feature enabled individually.
- No page URL, onion hostname, page text, credentials, payment data or browsing metadata leaves the local browser process as a result of inspection/filtering.
- Existing Tor leak tests and fingerprint-parity tests pass with default settings.
- Performance benchmark reports p50/p95/p99 and memory on documented hardware; no top-level navigation waits on DOM inspection or remote work.
- CI initializes submodules, verifies their pins/licenses, builds the bundle and runs the full test matrix.

## Agent handoff summary

Build the complete local, modular Access Engine described here. The purpose is to make browsing feel cleaner and more direct in seconds, not to defeat legitimate authorization. Prioritize extremely fast local matching, zero remote page-analysis dependencies, independent settings, safe fallbacks and onion-service compatibility. A page that might be important to a whistleblower must not be broken by an overconfident cosmetic or blocking rule.
