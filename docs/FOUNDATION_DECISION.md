# Foundation decision

Status: **Decided** (v0.1). Revisit only if one of the "would change our mind" conditions below happens.

## Question

Which existing, maintained engine and anonymity stack should Umbra build on? We aren't writing a browser engine, a cryptography library or an anonymity network from scratch.

## Candidates evaluated

| Candidate | Engine | Tor integration | Anti-fingerprinting | Maintenance & security updates | Android | Verdict |
|---|---|---|---|---|---|---|
| **Tor Browser** (Firefox ESR + tor patches) | Gecko | Native: bundled `tor` daemon, TorConnect, bridges, per-site circuit isolation, onion services, Onion-Location | Best available: letterboxing, uniform UA/fonts/locale, RFP, security levels, a large uniform user crowd | Tor Project rebases on every Firefox ESR security release | Yes (Fenix-based Tor Browser for Android) | **Chosen** |
| Firefox / GeckoView, our own Tor plumbing | Gecko | We'd have to rebuild everything Tor Browser already does (proxy bypass hardening, isolation, TorConnect) | Firefox RFP alone is weaker and isn't uniform with any crowd | Mozilla updates, but our Tor patches would be unmaintained | Yes | Rejected: re-implements Tor Browser, badly |
| Mullvad Browser | Gecko (Tor Browser minus Tor) | None; designed for VPN use | Same as Tor Browser | Tor Project | No | Rejected: no Tor |
| Brave (Tor windows) | Chromium | Tor only in private windows; less isolation; Brave documents its own limits | Farbling (randomization), different model | Brave | Partial | Rejected: Tor isn't the core, and Chromium wasn't preferred |
| Chromium + Tor proxy | Blink | SOCKS only; DNS/WebRTC/QUIC leak surface to patch ourselves | None by default | Google | Yes | Rejected |
| Arti (Rust Tor) | n/a (network only) | Tor's Rust rewrite | n/a | Tor Project, active | Embeddable | **Track, don't adopt yet**: Tor Browser still ships C-tor. When Tor Browser moves to Arti, Umbra inherits it for free |

## Decision

Umbra is a **Tor Browser derivative**. It inherits Gecko, the bundled tor daemon, every anti-fingerprinting patch and every security update. Umbra adds its own identity, search ecosystem, home and Explore pages, privacy dashboard and tooling on top.

### Two build tracks

1. **Overlay track (shipping now, v0.x).** The build takes the *signed, reproducible* official Tor Browser release, verifies its OpenPGP signature against a pinned key plus a pinned SHA-256, and applies Umbra's overlay (search config, branding, home page, prefs, one audited JS patch). This produces a real, complete browser in minutes on any machine. Upstream security fixes reach users as soon as CI rebuilds against the new upstream release.
2. **Source track (planned, v1.0).** A fork of `tor-browser-build` that compiles Umbra from source for desktop and Android, with its own update signing keys (MAR) and reproducible builds. This needs dedicated build infrastructure (roughly 16+ GB RAM and 100+ GB disk per platform, many hours per build). See [ROADMAP](ROADMAP.md).

The overlay track is not a mockup. It is the same engine binary the Tor Project ships, with a modified UI and configuration. Its limits are listed in [THREAT_MODEL.md](THREAT_MODEL.md#known-limitations).

### Fingerprint-uniformity rule

Tor Browser's protection depends on every user looking the same. **Umbra must never change anything a website can observe.** That covers prefs, fonts, UA, screen size behavior and enabled web APIs. This is enforced by:

- `tests/unit/test_prefs_policy.py`: a denylist of security-sensitive pref namespaces that Umbra's prefs layer can't touch.
- `tests/integration/test_parity.py`: launches Umbra and stock Tor Browser and asserts that 500+ security-relevant prefs are identical. This test already caught a real issue: shipping enterprise policies silently disables Web Serial, so Umbra ships no policies.

## What would change our mind

- Tor Browser stops being maintained, or stops following ESR security releases.
- Tor Browser adopts Arti. Umbra follows automatically.
- A user requirement that is impossible without diverging from Tor Browser's fingerprint. That requires an explicit, documented trade-off with the product owner.
