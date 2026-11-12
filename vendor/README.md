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
