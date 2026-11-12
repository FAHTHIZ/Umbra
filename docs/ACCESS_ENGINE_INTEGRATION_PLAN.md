# Access Engine upstream integration handoff

Status: **upstream sources pinned; native adapters and settings wiring remain agent work.**
Last reviewed: 2026-11-12.

This file is the implementation contract for the agent continuing Umbra. Do not create
a second Access Engine. Extend the existing `overlay/access/` implementation.

## Selected upstream components (pinned in this repository)

| Layer | Selected source | Pin / license | What to reuse | State |
|---|---|---|---|---|
| Ad/tracker/cosmetic filter engine | [Ghostery Adblocker](https://github.com/ghostery/adblocker) | `vendor/ghostery-adblocker`, `6f0610bf5eec1f31c4975ce0e707cdf47023e5b5`, v2.20.3, MPL-2.0 | Parser, matcher, request classifier, cosmetic-filter engine; local EasyList/EasyPrivacy and uBlock-compatible list assets where their individual licenses permit | Source pinned; Gecko adapter/build integration pending |
| Consent/CMP detection | [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) | `vendor/consent-o-matic`, `8ca8500d26434c586039e126ad091e1bfccd205d`, v1.1.5, MIT | CMP detection rules, rule schema, preference mapping and carefully selected action definitions | Source pinned; native Gecko adapter pending |
| Paywall/login/registration detection | Existing `AccessSignals.sys.mjs` + `content-frame.js` | Umbra code | Extend local metadata/DOM heuristics, bounded scoring, detection explanation | Existing implementation; broaden and test |
| Checkout/payment inspection | Existing `AccessSignals.sys.mjs` + `content-frame.js` | Umbra code | Provider-host recognition, form-action scheme/origin checks, redirect inspection, payment URI scheme-only classification | Existing implementation; broaden provider catalogue and tests |
| Phishing / suspicious-page warnings | Existing local signals; evaluate [Guardián Web](https://github.com/GoNNoTDa/guardian-web) separately | MIT upstream; small/new project (2026) | Review individual detectors for local-only reuse after independent code and privacy audit | Not vendored; candidate only |

## Why these are the selected components

- **One filter engine, not three.** Ghostery is an embeddable MPL-2.0 library with ABP/EasyList/uBlock-compatible filter syntax. Do not also embed uBlock Origin or AdGuard's full engine; both are GPL-3.0 projects and duplicate the same role.
- **Use the Consent-O-Matic rule catalogue, not its extension shell.** It is MIT-licensed and contains a large set of CMP rules. Its extension wrapper targets other browser extension APIs; adapt rules and required logic to Gecko rather than loading its manifest/background worker.
- **Don't bundle every cookie project.** `I-Still-Dont-Care-About-Cookies` is GPL-3.0 and documents an API service dependency; `Cookie Rejector` and `Cookie Calm` overlap the selected consent component and have narrower coverage. They are alternatives to compare, not engines to stack.
- **Do not include paywall-bypass extensions.** Projects that strip subscription checks, unlock premium content, defeat sign-in or payment authorization are explicitly out of scope. A paywall detector can identify the wall and explain legitimate options; it must not remove or circumvent the access control. The reviewed `unwalled` project combines detection with automatic archive redirects and is a tiny, single-commit extension, so it is not selected as a dependency.
- **Payment inspection is not payment authorization.** Provider recognition is heuristic. The browser can warn about insecure or mismatched form destinations; it cannot prove a merchant is honest or validate a payment.

## Required implementation

### A. Ghostery native adapter

1. Initialize submodules in build and CI (`git submodule update --init --recursive`).
2. Build a reproducible, pinned browser-compatible bundle from the Ghostery package and required transitive packages. Record exact package versions, hashes and all notices/licenses.
3. Do not import the WebExtension or Electron wrapper. Integrate the standalone engine into Gecko chrome code.
4. Map Gecko `nsIHttpChannel`/loadInfo to Ghostery's `Request.fromRawDetails()` fields and map Gecko content-policy types accurately.
5. Match locally. Translate only a block decision to channel cancellation. Never block a top-level document navigation by default; honor exception filters and first-party context.
6. Add a local, pinned ruleset snapshot: EasyList, EasyPrivacy, EasyList Cookie and a reviewed annoyance list. Preserve each list's attribution/license and record source revision/date/SHA-256. Do not assume all files inside a dependency share the package's MPL license.
7. Do not use remote filter fetches or remote inspection during a browsing session. Updates must be separate, explicit, integrity-checked and must not include visited hosts or onion addresses.
8. Cosmetic rules must be separately switchable and off by default. Do not execute unreviewed scriptlets.

### B. Consent adapter

1. Import only the Consent-O-Matic rule data and the minimum compatible evaluator needed by Umbra.
2. Convert its selectors/detectors/actions into a bounded native adapter; do not import browser-extension APIs.
3. Default to **detect and show controls**. The user may explicitly enable automatic rejection of optional categories.
4. If the CMP cannot be confidently identified or its reject/necessary-only control is ambiguous, do nothing and show the native site dialog.
5. Never select “accept all” automatically, forge consent state, write CMP cookies directly, or submit unrelated forms.
6. No external reporting, rule downloads or telemetry from an onion page.

### C. Access inspection: authentication, subscriptions, checkout and payment

Extend the existing local inspector to classify:
- login/sign-in forms;
- registration/create-account forms;
- authentication challenges and identity-provider handoffs;
- subscription/paywall/preview limits;
- checkout/payment flows;
- known provider labels (Stripe, PayPal, Adyen, Braintree, Square, Paddle, Lemon Squeezy, Shopify and other reviewed providers);
- suspicious payment form actions (plain HTTP, malformed URL, embedded URL credentials, unexpected cross-origin target, IP-literal destination, unsupported URI scheme);
- meta-refresh and observed browser redirect-chain anomalies.

Rules:
- Never read input values, passwords, OTPs, recovery codes, card numbers, CVVs, cookies, local/session storage, authorization headers, tokens or payment payloads.
- Never store full URLs, page text, onion hostnames, form actions or merchant identifiers in reports. Keep only bounded categories and indicator codes.
- Do not bypass login, MFA, account checks, paywalls, subscription entitlements, checkout gates, payment authorization or DRM.
- Do not automatically submit payment forms or interact with card fields.
- A known provider name is a recognition result, not a trust/safety certification.
- A suspicious-destination warning is heuristic and must explain the concrete signal.

### D. Public alternatives

Keep the existing explicit user-submitted OnionSearch workflow. Search only text the user types and submits. Never append the current URL, onion address, page title, page text, login details or payment metadata. Do not automatically mirror, archive or fetch restricted content.

## Settings switches to expose

Add each switch to Umbra Settings and the Access Engine dashboard. Use these exact preference names (or document a migration if the existing implementation uses aliases):

| Preference | UI label | Default | Notes |
|---|---|---:|---|
| `umbra.access.enabled` | Enable Access Engine | true for local inspection only | Existing master switch semantics must be clarified; do not make it silently enable network blocking |
| `umbra.access.adblocker.enabled` | Block ads | false | Requires Ghostery adapter |
| `umbra.access.trackers.enabled` | Block trackers | false | Requires Ghostery adapter |
| `umbra.access.cosmetic.enabled` | Hide ads and overlays | false | Fingerprint-visible DOM changes |
| `umbra.access.annoyances.enabled` | Block annoyances | false | Use a reviewed annoyance list |
| `umbra.access.cookie_detection.enabled` | Detect cookie/consent dialogs | true | Local-only detection |
| `umbra.access.cookie_auto_reject.enabled` | Automatically reject optional cookies | false | Only recognized CMP; never accept all |
| `umbra.access.login_detection.enabled` | Detect sign-in walls | true | Detection only |
| `umbra.access.registration_detection.enabled` | Detect registration walls | true | Detection only |
| `umbra.access.paywall_detection.enabled` | Detect subscription/paywalls | true | Detection only; no bypass |
| `umbra.access.checkout_detection.enabled` | Detect checkout/payment pages | true | Detection only |
| `umbra.access.payment_warnings.enabled` | Warn about suspicious payment destinations | true | Heuristic, not fraud verdict |
| `umbra.access.redirect_inspection.enabled` | Inspect suspicious redirects | true | Local inspection only |
| `umbra.access.public_alternatives.enabled` | Show public alternatives search | true | User-entered query only |

**Tor fingerprint policy:** keep network filtering, cosmetic changes and automatic consent actions OFF by default. Explain that these features can make Umbra more distinguishable from Tor Browser. Local read-only inspection can remain enabled.

## Test and release gates

- Unit tests for each signal, provider domain matching, suffix-boundary matching, internationalized domains, malformed URLs and false-positive cases.
- Ghostery conformance tests using upstream filter parser/matcher fixtures.
- Consent rule tests for reject-only, necessary-only, ambiguous controls, unknown CMPs, and no auto-accept.
- Browser tests for login, registration, paywall, checkout, known payment providers, invalid/insecure/cross-origin payment destinations, redirect chains and cookie CMPs.
- Run tests against controlled HTTPS fixtures and a controlled v3 onion fixture. Never crawl arbitrary onion sites for tests.
- Verify no request to an external service is caused by page inspection or filter matching. Verify DNS, socket, proxy and circuit-isolation leak tests.
- Verify Tor Browser fingerprint parity with all defaults; explicitly document the observable changes when opt-in features are enabled.
- Benchmark CPU/memory on large and mutation-heavy pages. Bound DOM scans, mutation work, rule memory and per-page time.
- CI must initialize submodules, build bundles, verify pinned SHAs and license files, then run unit/integration/leak suites.

## Explicitly not selected

| Project | Reason |
|---|---|
| [uBlock Origin](https://github.com/gorhill/uBlock) | Excellent but GPL-3.0 and duplicates Ghostery's selected engine role |
| [AdGuard Browser Extension](https://github.com/AdguardTeam/AdguardBrowserExtension) | GPL-3.0 and duplicates the filter-engine role |
| [I Still Don't Care About Cookies](https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies) | GPL-3.0; API dependency and redundant with Consent-O-Matic |
| [Cookie Rejector](https://github.com/bturksoy/cookie-rejector) | MIT, but narrower heuristic implementation; Consent-O-Matic's rule catalogue is the stronger base |
| [Cookie Calm](https://github.com/davegoldblatt/cookie-calm) | MIT and useful ideas, but a narrower derivative/alternative; avoid stacking duplicate consent engines |
| [Unwalled](https://github.com/nimanch/unwalled) | Detection is interesting, but it automatically redirects to archive snapshots and has minimal project history; implement detection-only signals in Umbra |
| [zapret](https://github.com/bol-van/zapret2) | Network-layer DPI tool, unrelated to browser page inspection; do not alter Tor transport |

The pinned sources are inputs for the agent's implementation, not a claim that their features are already active in Umbra.
