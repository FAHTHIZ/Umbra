# Roadmap

## Milestone 0 — Working directory prototype (repository baseline)

- [x] Responsive discovery interface and catalogue categories
- [x] Local search with no external search request
- [x] Local bookmarks with a visible unencrypted-storage warning
- [x] Official-source onion records with provenance and v3 validation
- [x] Safe copy-only onion hand-off; no false claim of Tor integration
- [x] Local server with restrictive headers and loopback-only default
- [x] Automated catalogue tests and GitHub Actions workflows
- [x] Tauri native desktop shell with package build workflow
- [x] Native Tor Browser folder selection and URL handoff (launch intent only; not route verification)

## Milestone 1 — Reliability and usability

- Validate every operator-published onion source and add a reproducible catalogue update process
- Add keyboard navigation and screen-reader checks to automated UI tests
- Add localization and configurable reduced-motion behavior
- Add a clear, user-initiated export/import for non-sensitive bookmarks
- Measure broken links and stale records without tracking users or visits

## Milestone 2 — Research workspace

- Source notes and provenance separate from browser history
- Evidence manifest with hashes and user-confirmed capture dates
- Original-file preservation and safe derivatives
- Encrypted-at-rest storage with explicit recovery trade-offs
- Strictly local analysis mode by default; no automatic cloud AI requests

## Milestone 3 — Trusted browsing integration

- [x] Desktop shell hands URLs to separately installed Tor Browser without embedding page content
- [x] No system-default browser fallback for native-app navigation
- [x] Validate v3 onion destinations and public HTTPS sources before launch


- Select a maintainable upstream browser foundation after reviewing its license, release process and platform support
- Prefer official Tor Browser releases as the reference implementation; preserve the upstream privacy model
- Build a narrow directory-to-browser handoff and visible connection-state UX
- No generic browser webview marketed as Tor-equivalent
- Test no-direct-fallback behavior, onion host handling, redirects, DNS, crash handling and fingerprinting regressions

## Milestone 4 — Security readiness

- Threat-model workshops and secure-development review aligned with OWASP ASVS and NIST SSDF
- Signed releases and dependency/action pinning
- Fuzz URL and catalogue parsing
- Independent security review before high-risk journalist use
- Publish known limitations and a responsible vulnerability-reporting process

## Non-goals

- Automatically scraping or indexing every onion service
- Promising perfect anonymity
- Harvesting user metadata in the name of security
- Sending private searches to third-party providers by default
- Automatically opening or executing unknown downloads
