# Security policy

Umbrella is an early-stage public-interest research directory prototype. It is not currently a hardened browser, anonymity system, secure submission tool, or forensic evidence vault.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting / Security Advisories feature for this repository when available. Do not publish access tokens, private onion keys, personal source identities, real whistleblower submissions, or a live exploit in an issue.

For a report, include the affected commit, impact, reproducible steps using non-sensitive test data, and any mitigation you have tried. Do not test against real third-party onion services or organizations without permission.

## Current security properties

- No application accounts or backend database
- No analytics, ad network, third-party scripts, or remote fonts
- Directory filtering runs in the browser against a bundled catalogue
- The local server binds to 127.0.0.1 by default and does not log requests
- Only operator-published or official-documentation onion addresses are seeded
- Onion actions copy an address; they do not attempt to proxy it or silently launch a different browser
- The local server sets restrictive content and browser security headers

## Known limitations

- Bookmarks are plain localStorage values, not encrypted at rest.
- GitHub Pages deployment is a static website; hosting providers can observe ordinary site requests.
- The interface does not control the network route or browser configuration.
- No independent security audit has been completed.
- A resource's presence in the catalogue is not a safety guarantee.
- There is no encrypted case vault, account protection, file sandbox, Tor integration, or secure update-signing implementation in this prototype.

## Security change rules

1. Do not add telemetry or third-party calls without an explicit design review.
2. Do not add a generic proxy or fetch onion URLs on behalf of users.
3. Do not claim Tor anonymity for a generic webview.
4. Do not execute downloaded content or automatically preview active documents.
5. Validate every new catalogue entry and record its primary provenance.
6. Keep security-sensitive data out of logs, issue reports, URLs and analytics.
