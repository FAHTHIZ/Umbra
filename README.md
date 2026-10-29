# Umbrella

Umbrella is a privacy-first discovery directory for public-interest research and operator-published onion-service resources.

The current repository delivers a working, dependency-free web prototype: a local catalogue, local-only search, bookmarks, source provenance, and a safe hand-off flow for onion addresses. It is deliberately honest about what it is not: this web prototype is not Tor Browser, does not create a Tor circuit, and does not claim to provide anonymity.

## Run locally

Requirements: Node.js 20 or newer.

- Run npm start
- Open http://127.0.0.1:4173
- Run npm test to validate the bundled catalogue and source rules

The development server binds to loopback by default and emits no request logs. To expose it on another interface, set HOST explicitly; do that only on a network you trust.

## What works today

- Responsive browser-like discovery interface
- Local-only search over the bundled catalogue; searches are not sent to a server
- Browse categories for onion services, privacy, journalism, digital rights and research
- Curated v3 onion-service records whose addresses are listed by their operators or official documentation
- One-click copy of onion addresses for manual opening in Tor Browser
- Local bookmarks stored in this browser profile
- Source provenance, check date, and caveats on directory records
- No accounts, analytics, ad tech, remote fonts, third-party JavaScript or search APIs
- Security headers in the local development server and automated catalog tests
- GitHub Actions checks and Pages deployment workflow

## Important limits

- The site cannot open onion services through Tor on its own. Copy the address and paste it into the official Tor Browser. Do not paste sensitive investigation details into this prototype.
- Bookmarks use browser localStorage and are not encrypted. Anyone with access to the same browser profile may be able to inspect them. This is not an evidence vault.
- Catalogue entries can become stale. An address listed by an operator is not proof the service is online, benign, or currently operated by the expected person.
- The prototype does not scrape the dark web, crawl onion services, inspect downloaded files, store case evidence, or offer account security.
- A website cannot guarantee anonymity. Device compromise, identifiable logins, browser fingerprinting, user actions, hosting logs and destination behavior remain relevant risks.

## Security direction

Keep the discovery catalogue separate from browsing traffic. Search and filtering should remain local. Onion links must be handed off to a trusted Tor Browser runtime; never silently route them through the ordinary web or a third-party proxy. Do not add analytics or per-click tracking.

See SECURITY.md and docs/ for the threat model, metadata inventory, boundaries, sources and next milestones.
