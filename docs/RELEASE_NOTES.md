# Umbra 0.1.0 (alpha)

The first public build of Umbra for **Linux x86-64 and aarch64**, with an experimental **Windows x86-64 portable** zip, based on **Tor Browser 16.0.1** (Firefox ESR 153.7.0).

## Included
- Umbra identity: name, icons, and a new search-first home page with a provider switcher
- **OnionSearch.io** as the default search engine, plus DuckDuckGo (also via onion), Brave Search (also via onion), Startpage (also via onion), Ecosia, Google, Mojeek and Wikipedia, and custom engines
- **Umbra Explore**: a curated directory of operator-published onion services, with every address checksum-verified
- Fingerprint parity with Tor Browser 16.0.1, verified by automated comparison
- Leak-tested: SOCKS-only traffic, remote DNS, fail-closed, per-site circuit isolation
- **Umbra Privacy** dashboard (Tools → Umbra Privacy)
- Release notice when a new Umbra version is out, checked anonymously over Tor
- **Umbra Access Engine** (experimental): local page inspection; ad/tracker filtering is opt-in and off by default
- **Umbra Source** (experimental): the SecureDrop directory, opened in a separate, Safest-level Umbra instance
- **Umbra Vault** (experimental): encrypted export and import of bookmarks (and logins, if enabled) using the browser's built-in crypto
- **Umbra Desk** (experimental): research notes that are kept only in memory, open tabs grouped by site, and Close and forget (New Identity)
- **Umbra Assistant** (experimental): local page analysis (key sentences, outline, onion addresses, links). It uses no AI model and no network.
- **Umbra Investigate** (experimental): a separate, onion-only Umbra instance for manual investigation. It blocks clearnet pages, redirects and subresources and explains why. It inspects pages read-only (it never logs in, solves CAPTCHAs, pays or submits anything). It keeps local, hash-chained evidence cases that hashdeep, mitmproxy, exiftool and Timesketch can read, and can encrypt them.
- **Investigation toolkit** (experimental): upstream tools such as TorBot, OnionSearch, onionscan, onionscout and darkdump, pinned to exact commits and run in containers that can only reach onion services
- Verified, deterministic builds (OpenPGP plus SHA-256 pinned upstream)

## Known limitations
- No automatic updater yet. Watch this repository for new releases.
- Windows is a portable build that isn't code-signed yet, so SmartScreen will warn. macOS and Android are on the roadmap.
- Experimental modules are tested but new. Please report issues.
- Tor reduces tracking and censorship. It doesn't make you anonymous against every adversary. See `docs/THREAT_MODEL.md`.

Verify: `sha256sum -c --ignore-missing SHA256SUMS`
