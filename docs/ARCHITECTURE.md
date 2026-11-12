# Umbra architecture

Living document. Update it in the same commit as any architectural change.

```
                        ┌──────────────────────────── Umbra ─────────────────────────────┐
                        │  Umbra Home / Search / Explore  (overlay/home, overlay/search)   │
                        │  Umbra Privacy dashboard        (about:preferences panes)*      │
                        │  Branding · prefs layer · audited patches (overlay/*)           │
                        ├─────────────────────────────────────────────────────────────────┤
 upstream, unmodified → │  Tor Browser: Gecko (Firefox ESR) + tor patches                 │
                        │   · multi-process sandbox · Fission site isolation              │
                        │   · first-party isolation · RFP / letterboxing · security levels│
                        │   · TorConnect · bridges · circuit display · Onion-Location     │
                        ├─────────────────────────────────────────────────────────────────┤
                        │  tor daemon (C-tor; Arti when upstream switches) + PTs          │
                        └─────────────────────────────────────────────────────────────────┘
   * = uses upstream panes today; dedicated Umbra dashboard is on the roadmap.
```

## Repository layout

| Path | Purpose |
|---|---|
| `upstream/tor-browser.lock.json` | Pinned upstream version, SHA-256 per artifact, signing-key fingerprint |
| `tools/umbra_build/` | Build pipeline: `fetch` → `verify` → `extract` → `overlay` → `package` |
| `overlay/search/` | Search engine config (Firefox search-config v2 format). OnionSearch is default |
| `overlay/home/` | Umbra home page that replaces `about:tor` content. Strict CSP, no remote loads |
| `overlay/explore/` | Curated onion directory. Every address is v3-checksum-validated in tests |\n| `overlay/access/` | Native Access Engine: local request rules, content-frame inspection, dashboard and payment/login indicators |
| `overlay/prefs/umbra-prefs.js` | Non-fingerprintable prefs only (UI, search UX, update URLs, tab unloading) |
| `overlay/patches/patches.json` | Anchored JS patches. Build fails if an anchor isn't found exactly once |
| `tests/unit` | Fast, no browser: config, onions, prefs policy, build tools |
| `tests/integration` | Real headless browser via Marionette: search, branding, home, tabs, WebRTC, **parity vs upstream** |
| `tests/leak` | Canary SOCKS + `/proc` socket monitor: proxy-only egress, remote DNS, fail-closed, circuit isolation |
| `bench/` | Umbra vs upstream benchmark on identical hardware |
| `.github/workflows/` | CI, release, daily upstream watch |
| `android/` | Android plan (source track) |

## Build pipeline

1. **Fetch** the upstream artifact and its `.asc` over HTTPS (TLS 1.2+, https-only redirects).
2. **Verify**: the SHA-256 must match the lock file **and** the OpenPGP signature must be a `VALIDSIG` whose *primary* key equals the pinned fingerprint. The check runs in a throwaway GnuPG home, so the user's keyring is never trusted.
3. **Extract** with Python's `data` tar filter (no absolute paths, no device files, no traversal).
4. **Overlay**: edit the two `omni.ja` archives in memory, preserving entry order and writing deterministic zips (fixed timestamps and modes). Every change is recorded in `Browser/UMBRA_BUILD.json`.
5. **Package**: a deterministic `tar.xz` (sorted entries, uid/gid 0, fixed mtime) plus `SHA256SUMS`.

Running the same lock file and the same overlay twice produces byte-identical `omni.ja` files. That property is tested.

## Network model

- **Protected mode (default, the only mode in v0.1):** all traffic goes through the bundled tor's SOCKS port with remote DNS. Tor Browser uses per-first-party SOCKS credentials, so separate sites get separate circuits. If tor is down, nothing goes out: there is no direct fallback. All three properties are verified in `tests/leak`.
- **Search provider ≠ anonymity network.** The search provider only receives the query. Every provider, including OnionSearch, Google and the rest, is reached *through Tor*. Onion-hosted providers (DuckDuckGo, Brave, Startpage onions) also keep the connection inside the Tor network.
- **Ordinary (non-Tor) browsing** is deliberately *not* in the same process or profile. If it's added later, it must be a separate profile with separate storage and a visually distinct UI. See the roadmap.

## Module map (Umbra platform)

| Module | v0.1 state | Where |
|---|---|---|
| Umbra Search | Implemented | `overlay/search`, home page switcher, address bar |
| Umbra Explore | Implemented (curated directory) | `overlay/explore`, home page |\n| Umbra Access Engine | Experimental; packaged in browser overlay, filtering opt-in | `overlay/access`, browser chrome dashboard |
| Umbra Privacy | Partial: upstream security-level and connection panes, linked from home | `about:preferences#privacy`, `#connection` |
| Umbra Vault | Upstream bookmarks/passwords; persistent-history opt-in via upstream setting | — |
| Umbra Downloads | Upstream downloads manager (pause/resume/progress) | `about:downloads` |
| Umbra Desk / Source / Assistant | Design docs only | `docs/modules/` |

## Change process for new ideas

Every new idea gets an entry in [IDEAS.md](IDEAS.md) covering feasibility, architectural consequences, security and performance impact, and a decision. The work is implemented only after the product owner approves it, and existing tests must stay green.
