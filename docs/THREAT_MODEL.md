# Umbra threat model

> **Using Tor, and so using Umbra, does not guarantee anonymity.** It makes several important kinds of tracking and surveillance much harder. This document explains which ones, and where the protection ends.

Umbra inherits Tor Browser's design and threat model ([Tor Browser design document](https://2019.www.torproject.org/projects/torbrowser/design/)). This page covers what is specific to Umbra.

## Assets

1. **Network identity**: the user's IP address and location.
2. **Cross-site linkability**: whether activity on site A can be tied to site B.
3. **Browsing content and history** on the device.
4. **Search queries.**
5. For journalists and sources (planned modules): the **identity of sources** and the content of submissions.

## Adversaries considered

| Adversary | Capability | Umbra/Tor Browser mitigation |
|---|---|---|
| Local network / ISP | Observes or blocks traffic | Tor encryption; bridges and pluggable transports (obfs4, Snowflake, meek, WebTunnel, Conjure) for censorship |
| Destination website / ad network | Runs JS, fingerprints, sets cookies | First-party isolation, RFP and letterboxing, a uniform fingerprint shared with all Tor Browser users, security levels, WebRTC off |
| Search provider | Sees queries, timing, exit IP | Reached over Tor. Suggestions are off by default. Onion providers available |
| Malicious exit relay | Sees and modifies plaintext to clearnet | HTTPS-Only mode (upstream default). Onion services avoid exits |
| Malicious onion service | Phishing or lookalike addresses | Explore lists only operator-published addresses, v3-checksum-validated in CI |
| Supply-chain attacker | Tampered upstream binary or mirror | Pinned SHA-256 **and** OpenPGP `VALIDSIG` against a pinned primary key in an isolated keyring |
| Malicious extension | Reads all pages, fingerprints | Signed-extensions-only (upstream). Users are warned in docs that extensions change their fingerprint |

## Out of scope (Umbra can't defend against these)

- **Global passive adversary** doing end-to-end traffic correlation (Tor's own stated limit).
- **Compromised device**: malware, keyloggers, a hostile OS, physical seizure of an unlocked device.
- **User-identifying behavior**: logging into personal accounts, revealing details, writing style.
- **Opened downloads**: documents and media opened outside Umbra can make direct connections.
- **Zero-day browser exploits.** Mitigated by sandboxing and security levels, but not eliminated. Use the "Safest" level for high-risk work.

## Umbra-specific risks and decisions

1. **Update lag (overlay track).** Upstream Tor Browser updates in place. Umbra must rebuild and re-release. The `upstream-watch` workflow checks daily and opens a rebuild automatically. **Until in-app Umbra updates exist (v1.0), users must install new Umbra releases manually.** This is the most important known limitation.
2. **Default search provider trust.** OnionSearch.io is a third-party clearnet service. When we reviewed it, its homepage loaded JavaScript and CSS from third-party CDNs (jsDelivr, cdnjs) and contained commented-out code that would redirect searches through an ad network. Because traffic goes over Tor, those parties see a Tor exit, not the user's IP. Still, users should treat search results as untrusted, and Umbra keeps one-click switching to onion-hosted providers (DuckDuckGo, Brave, Startpage onions).
3. **Fingerprint uniformity.** Any web-observable change splits Umbra users off from the Tor Browser crowd. This is enforced by the parity test (see FOUNDATION_DECISION). The one thing that does differ is the **window icon and UI text**, which websites can't see.
4. **Telemetry: none.** Umbra adds no network requests of its own. The home page is local and runs under `default-src chrome:` CSP. The build tool is the only component that touches the network, and only at build time.
5. **Access Engine fingerprint trade-off.** Local page inspection is read-only and does not send page data or onion addresses to a third party. Network blocking and cosmetic DOM changes are observable by websites. Both are disabled by default; enabling them may make a user more distinguishable from the wider Tor Browser population. The dashboard warns before users opt in. The starter filter list is not comprehensive and the feature is experimental.

## Known limitations (v0.1)

- Desktop Linux x86-64 is the only verified build. Windows, macOS and Android are planned (see ROADMAP).
- No in-app updater (see risk 1).
- Live Tor bootstrap is tested in CI, where relays are reachable, not in every development environment.
- Umbra Desk, Source and Assistant are design documents, not code.
- Access Engine page inspection and its starter rules are experimental; no production security audit or end-to-end onion-site compatibility test has been completed.


## Release notice request

Umbra makes **one** background request of its own: the daily release check (`umbra.update.notify`, on by default). It replaces upstream Tor Browser's update ping, which Umbra disables.
- What GitHub (and the Tor exit) learn: that some Tor user runs Umbra and checked for updates. No version, profile or device identifiers are sent, and cookies are omitted.
- Integrity: the response is only used to compare `tag_name`. The link in the notice is built from a fixed URL, so a malicious response can't redirect users. Nothing is downloaded automatically.
- Users who don't want any background request can set `umbra.update.notify = false`. The Privacy dashboard then shows a review warning, because missed security updates are the larger risk.
