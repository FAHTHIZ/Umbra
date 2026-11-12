# Umbra Access Engine

Status: **initial native integration foundation — not production security certification**

Umbra Access Engine is designed as an in-browser Gecko capability. Page inspection runs in the content process; request classification and report publication run in privileged browser code. The engine does not use a remote page-analysis service.

## Current components

| File | Responsibility |
|---|---|
| `modules/umbra/FilterRules.sys.mjs` | Pure local rule primitives, onion-host helpers and provider identification |
| `modules/umbra/AccessEngine.sys.mjs` | Parent-process HTTP request observer and sanitized report publisher |
| `modules/umbra/UmbraAccessChild.sys.mjs` | Bounded DOM metadata inspection in the content process |
| `modules/umbra/UmbraAccessParent.sys.mjs` | Receives and sanitizes child reports |
| `modules/umbra/UmbraAccessStartup.sys.mjs` | Registers the JSWindowActor and starts the request observer |
| `tests/umbra/filter-rules.test.mjs` | Node unit tests for pure rule primitives |

## Required browser integration

This repository currently does not contain a complete Gecko browser source tree or build configuration. The modules therefore need to be included in the browser package at the resource path used below:

1. Package the files under `modules/umbra/` as `resource:///modules/umbra/` (in a Firefox-derived source tree this normally means the browser modules resource mapping).
2. Import `registerUmbraAccessEngine` from `resource:///modules/umbra/UmbraAccessStartup.sys.mjs` in the privileged browser startup path.
3. Call `registerUmbraAccessEngine()` once after profile and observer services are available.
4. Add the dashboard observer for `umbra-access-page-report` and `umbra-access-request-blocked`. Do not expose full URLs or page contents in that UI.
5. Verify that browser shutdown calls `unregisterUmbraAccessEngine()`.

Do not copy the old standalone frame script into the browser in parallel with the JSWindowActor. There must be one content inspection path, not two.

## Privacy boundaries

- No filter-list downloads are implemented in this foundation.
- No onion URL, page URL, referrer, search query, DOM text, form value, cookie, token or credential is sent to an external service.
- Page reports contain bounded booleans, provider labels, indicator codes, overlay counts and an onion boolean only.
- The child actor only runs on top-level HTTP(S) documents. Onion services use HTTP(S) URLs with an onion hostname and are included by the HTTP match patterns.
- Onion hostnames are never included in the report payload.
- Unknown request metadata is allowed rather than risking accidental breakage.
- No telemetry is implemented.

## Current limitations

- The built-in ad/tracker domain sets are deliberately small starter rules. They are not equivalent to EasyList or EasyPrivacy and will miss many ads and trackers.
- No third-party filter list is downloaded or parsed yet.
- Cookie dialogs are detected but never automatically accepted or rejected. Consent must remain an explicit user decision.
- Login, registration, paywall and checkout detection is heuristic. It can produce false positives and false negatives.
- Payment provider identification is based on known script, iframe and form destination hostnames. It does not validate the merchant, transaction or recipient.
- Suspicious payment indicators are warnings, not fraud verdicts.
- Public alternative-source discovery is not implemented. It must be a separate, user-initiated search feature with onion destinations excluded from all external requests.
- Cosmetic cleanup currently handles a small set of obvious promotional overlay patterns. It does not defeat authentication or subscription controls.
- The browser startup hook, package mapping, UI, real browser integration tests and Tor runtime tests must be completed in the consuming browser tree.

## Security review items before production

- Review the request observer against the exact Gecko version and network stack used by Umbra.
- Verify that blocking channels does not bypass or modify Tor proxy routing.
- Confirm all DNS and socket traffic remains under the browser's configured Tor proxy.
- Verify fail-closed behavior when Tor is unavailable; never fall back to direct networking.
- Verify process isolation, site isolation, sandbox settings and anti-fingerprinting defaults.
- Add browser-level tests for normal HTTPS, valid v3 onion navigation, redirects, subresources, downloads, WebSockets and service workers.
- Add a canary SOCKS proxy test that proves every network connection uses the configured proxy.
- Audit all IPC payloads to ensure onion URLs and browsing identifiers cannot be transmitted.
- Vendor any external rule lists with license, source, version, checksum and update metadata.
- Complete a security review before describing Umbra as suitable for high-risk whistleblower use.

## Run the pure unit tests

Requires Node.js 20 or newer:

```sh
node --test tests/umbra/*.test.mjs
```
