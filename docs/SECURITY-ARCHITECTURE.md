# Security architecture

## Present version

Umbrella currently consists of a static browser interface, a versioned JSON catalogue, and an optional local Node.js preview server. There is no application backend, user account service, remote search provider, analytics service, downloader or browser-engine integration.

## Trust boundaries

1. Static Umbrella interface renders locally bundled catalogue records. Search and filtering execute in the browser. Dynamic record text is HTML-escaped.
2. The bundled catalogue includes HTTPS source records and v3 onion addresses. Runtime validation rejects duplicate IDs, unsupported categories, non-HTTPS web links, credential-bearing URLs and malformed onion addresses.
3. External public websites open only after an explicit user action. Destination websites and their hosting infrastructure have their own logs and privacy practices.
4. Onion navigation in this prototype copies an address for manual opening in official Tor Browser. It does not resolve onion hosts, proxy requests or claim to isolate network traffic.
5. Bookmark storage holds catalogue IDs in browser localStorage. It is not encrypted and can be visible to people or software with access to the same browser profile.
6. The local preview server binds to loopback by default, serves only files under the site directory, rejects non-GET/HEAD requests, applies restrictive headers and emits no request logs.

## Security controls implemented

- Strict same-origin Content Security Policy; no inline scripts, third-party scripts or remote fonts
- Referrer policy set to no-referrer
- Frame blocking, MIME sniffing protection, restrictive permissions policy and same-origin isolation headers
- Loopback-only local server default and path traversal checks
- HTTPS-only external source URLs
- Strict v3 onion hostname validation
- No automatic network fetches from URLs inside catalogue data
- No query persistence, account, analytics or backend search endpoint
- Automated tests for catalogue integrity and URL validation

## Target architecture, not yet implemented

A production browser requires a maintained browser engine with upstream privacy controls; a trusted Tor transport; a narrow interface between the directory and navigation; isolated download handling; an encrypted case store; signed updates; safe crash reporting; and an independent security assessment. These must be separate modules with explicit permissions.

A generic Electron or Chromium webview routed through a proxy is not an acceptable substitute for Tor Browser's fingerprinting protections. Any browser fork must keep up with upstream security updates and preserve the Tor Browser privacy model.
