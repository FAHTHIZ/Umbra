# Roadmap

Product direction belongs to the project owner. Engineering proposes; the owner approves.

## v0.1 — Overlay foundation (current)
Verified Linux build, OnionSearch default plus 12 providers, Umbra home and Explore, branding, leak and parity tests, CI, releases, docs.

## v0.2 — Platforms & dashboard
- Overlay builds for Windows (portable installer repack), macOS (DMG repack, re-signing caveats), Linux aarch64.
- **Umbra Privacy dashboard** (`about:umbra`): connection state, current circuit, security level, per-site permissions summary, one-click New Identity. Implemented as a privileged about: page using existing Tor Browser modules (TorConnect, TorProvider, SecurityLevel). No new network code.
- In-browser "new Umbra release available" notice. The release check runs over Tor at most once a day and can be disabled.

## v0.3 — Explore & Vault
- Explore: community-submitted directory with signature-verified updates (signed JSON shipped in releases, not fetched live).
- Vault: encrypted bookmark/password export and import (local only, user passphrase, Argon2id + AES-GCM through NSS/WebCrypto).

## v0.4 — Journalist modules (isolated)
- Umbra Desk: separate profile with "Safest" security level, no persistent storage, a document-scrubbing guide.
- Umbra Source: SecureDrop-aware flows (opens SecureDrop instances in an isolated profile). **No custom submission server.** We'd integrate SecureDrop rather than build our own.

## v1.0 — Source track
- Fork of `tor-browser-build` with Umbra branding compiled in. Own MAR signing keys, in-app updates, reproducible builds verified by independent rebuilders.
- **Android**: Fenix-based Tor Browser for Android with the Umbra overlay applied at source level.

## Continuous
- Track every Tor Browser stable release within 24h (upstream-watch).
- Track Arti adoption upstream.
