# Vendored upstream components

## Ghostery Adblocker

- Upstream: https://github.com/ghostery/adblocker
- Pinned upstream commit: `6f0610bf5eec1f31c4975ce0e707cdf47023e5b5`
- Upstream package: `@ghostery/adblocker`
- Upstream package version at this pin: `2.20.3`
- License: Mozilla Public License 2.0 (MPL-2.0)
- Integrated source path: `vendor/ghostery-adblocker` (Git submodule)

This is the standalone embeddable filter engine, not the Ghostery browser extension.
The extension repository is GPL-3.0 and is deliberately not included.

The pinned upstream provides the filter parser/matcher and filter-list assets. Umbra's
Gecko integration must remain in `overlay/access/`: adapt Gecko request metadata to
Ghostery's `Request` abstraction, call the filter engine locally, and translate only
safe block/redirect decisions into Gecko channel actions. Keep top-level navigation
fail-open, do not transmit visited URLs or onion hostnames to remote list services,
and preserve Tor Browser fingerprint-parity defaults. Do not enable cosmetic or
network filtering by default without an explicit product decision and parity tests.

The submodule is pinned to an immutable upstream commit so the upstream source can be
checked out reproducibly. Build tooling/CI must initialize submodules before compiling
or packaging the engine. Do not copy Ghostery's extension UI, telemetry, or remote
tracker lookups into Umbra.

## Consent-O-Matic

- Upstream: https://github.com/cavi-au/Consent-O-Matic
- Pinned upstream commit: `8ca8500d26434c586039e126ad091e1bfccd205d`
- Upstream version at this pin: `1.1.5`
- License: MIT
- Integrated source path: `vendor/consent-o-matic` (Git submodule)

This upstream is included as a source/rule reference for the Gecko-native consent
adapter. Reuse its CMP detector/rule definitions and preference model; do not ship
its browser-extension manifest, browser-specific background APIs, telemetry or
build output as if it were a drop-in Gecko component. Adapt only the minimal required
logic into Umbra's chrome/content architecture and preserve its MIT notice.

Consent handling must be user-configured. The default behavior is detection and a
visible choice; automatic rejection of optional categories is available only after
the user explicitly enables that preference. Never silently accept all, forge a
consent signal, or click controls outside a recognized CMP rule.
