# Roadmap

Product direction belongs to the project owner. Engineering proposes; the owner approves.

## v0.1 — Overlay foundation (current)
Verified Linux build, OnionSearch default plus 12 providers, Umbra home and Explore, branding, leak and parity tests, CI, releases, docs.

## v0.2 — Platforms & dashboard
- ✅ Linux aarch64 and 🧪 Windows portable overlay builds (done in 0.1). macOS still needs an Umbra Developer ID (owner decision).
- ✅ **Umbra Privacy dashboard** (chrome page, Tools/Umbra menu): connection state, security level and protections. 🧪 Current circuit and one-click New Identity are being added. 📋 Per-site permissions summary.
- ✅ In-browser "new Umbra release available" notice (over Tor, at most daily, can be disabled).

## v0.3 — Explore & Vault
- Explore: community-submitted directory with signature-verified updates (signed JSON shipped in releases, not fetched live).
- 🧪 Vault: encrypted bookmark/password export and import (done in 0.1). It uses PBKDF2-HMAC-SHA-256 (600k) + AES-256-GCM, because WebCrypto/NSS has no Argon2id and we won't ship our own. 📋 Argon2id or age once a vetted, vendored implementation is chosen.

## v0.4 — Journalist modules (isolated)
- 🧪 Umbra Source (done in 0.1): SecureDrop directory, opened in an isolated Safest-level instance. **No custom submission server.** 📋 Document metadata-scrubbing guide.
- 🧪 Umbra Desk (done in 0.1): memory-only research notes, tab overview, close-and-forget. 📋 Surface native tab groups.
- 🧪 Umbra Assistant (done in 0.1): model-free local page analysis. ❓ Bundled local model (owner decision).

## v1.0 — Source track
- Fork of `tor-browser-build` with Umbra branding compiled in. Own MAR signing keys, in-app updates, reproducible builds verified by independent rebuilders.
- **Android**: Fenix-based Tor Browser for Android with the Umbra overlay applied at source level.

## Continuous
- Track every Tor Browser stable release within 24h (upstream-watch).
- Track Arti adoption upstream.
