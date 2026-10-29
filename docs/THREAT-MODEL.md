# Threat model

## Intended use

A local-first discovery directory for learning about onion services, browsing public-interest resources, and organizing bookmarks. A future Umbrella browser may support investigative research, but this prototype must not be used as a high-risk operational-security tool.

## Assets

- Search terms typed into the local search field
- Bookmark IDs and reading interests in the current browser profile
- The user's browser/device identity and network metadata
- Source addresses and the catalogue's provenance records
- Future research notes, source identities and collected evidence (not handled by this version)
- Integrity of the application and its catalogue

## Adversaries and failure modes

- A third-party destination that tracks visitors or hosts misleading information
- A malicious or compromised catalogue entry
- Someone with access to the same browser profile
- A compromised device or browser extension
- A hosting provider that observes requests for the static site
- A future dependency/update supply-chain compromise
- A mistaken assumption that a listed onion address is safe or available

## Mitigations in this prototype

- No accounts, query analytics, advertising profiles, or remote search calls
- Local search and filtering only
- Operator provenance for seeded onion addresses
- Strict validation of URL type and v3 onion syntax
- Escaped text rendering and restrictive Content Security Policy
- No automatic page-fetching, crawler, proxy or download execution
- Clear UI disclosure that this site is not Tor Browser
- Bookmarks limited to record IDs, with an explicit warning that they are not encrypted

## Out of scope and residual risk

This prototype does not protect a device from malware, stop destination-site tracking, conceal direct requests to the hosting site, provide browser-fingerprinting resistance, encrypt bookmarks, securely receive whistleblower material, or guarantee the identity of a source. The static site host can observe ordinary site traffic. A user who opens external websites exposes some metadata to those sites.

## Release bar for a future browser

Before any anonymity claims: use an established Tor Browser-compatible engine, review changes against upstream, verify onion routing with test infrastructure, fail closed when Tor is unavailable, audit DNS and redirect behavior, test fingerprinting regressions, isolate untrusted content, review update integrity, and commission independent security review.
