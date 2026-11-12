# Implementation checklist

Legend: ✅ implemented **and verified by an automated test or a recorded run** · 🟡 provided by upstream Tor Browser (works, not separately tested by Umbra) · 🧪 experimental · 📋 planned

Rule: nothing gets marked ✅ without a test or a reproducible measurement in this repo.

## Foundation & build
- ✅ Pinned upstream (Tor Browser 16.0.1, Firefox ESR 153.7) with SHA-256 + OpenPGP key pin — `tests/unit/test_build_tools.py`, every build
- ✅ Deterministic omni.ja rewrite — `test_omni_roundtrip_is_deterministic`
- ✅ Deterministic tar.xz packaging + SHA256SUMS
- ✅ Anchored source patches (build fails on upstream drift)
- ✅ Linux x86-64 desktop build
- ✅ Linux aarch64 build: pinned and verified upstream; browser omni.ja byte-identical to the tested x86-64 one. CI builds **and runs** the full integration, parity and leak suites natively on `ubuntu-24.04-arm`
- 🧪 Windows x86-64 portable zip: pinned and verified upstream portable .exe → 7z → same overlay → deterministic zip (verified locally: anchored patches apply; byte-reproducible). CI runs the integration and parity suites on `windows-2025`. The exe icon stays upstream's (Authenticode)
- 📋 macOS (.dmg): modifying the bundle breaks Tor Project's notarized signature, so it needs an Umbra Developer ID plus notarization (owner decision: Apple account)
- 📋 Android (source track; see `android/README.md`)
- 📋 Source track: `tor-browser-build` fork, Umbra MAR signing keys, reproducible builds

## Browser experience
- ✅ Tabs, back/forward/reload — `tests/integration::test_tabs_and_navigation`
- ✅ Umbra home page (search-first, provider switcher, Explore) — `test_home_page_defaults` + screenshot
- 🟡 Address bar URL detection, keyword search, one-off provider buttons
- 🟡 Bookmarks & folders, Library, import/export
- 🟡 History & session restore. Off by default (permanent private browsing); opt-in via Settings → Privacy → "Always use private browsing mode"
- 🟡 Private sessions & automatic data clearing (New Identity, clear on exit)
- 🟡 Downloads manager (pause/resume/progress), safe download prompts
- 🟡 Audio/video playback, fullscreen, context menus, keyboard shortcuts
- 🟡 Site permissions & notifications controls
- 🟡 Password manager & autofill
- 🟡 Extensions (signed WebExtensions)
- 🟡 Themes (Firefox themes), light/dark
- ✅ Session-restore and tab-unloading tuning (prefs layer, non-fingerprintable)

## Search
- ✅ OnionSearch.io default (normal + private) — `test_default_search_is_onionsearch`
- ✅ DuckDuckGo (+ no-AI, + onion), Brave (+ onion), Startpage (+ onion), Ecosia, Google, Mojeek, Wikipedia — `test_all_providers_registered`
- ✅ Instant provider switching (home switcher + settings) — `test_provider_switch_and_custom_engine`
- ✅ Custom user-defined engines — same test
- ✅ Suggestions supported per provider, **off by default** for privacy
- ✅ Onion discovery (OnionSearch) + curated Explore directory with v3 checksum validation — `test_onions.py`

## Tor & networking
- 🟡 Integrated tor daemon, TorConnect, bridges (obfs4, Snowflake, meek, WebTunnel, Conjure)
- 🟡 Circuit display, New Circuit for this site, Onion-Location
- ✅ All traffic through SOCKS with remote DNS — `tests/leak`
- ✅ No direct fallback when Tor is down — `tests/leak`
- ✅ Per-first-party circuit isolation — `tests/leak`
- 🧪 Live Tor bootstrap test in CI (`.github/workflows/ci.yml`, `live-tor` job)
- 📋 Arti (follows upstream)
- 📋 Separate non-Tor "ordinary" profile (requires product decision; see IDEAS.md)

## Access Engine
- 🧪 Local page inspection (login, registration, paywall, checkout, cookie-dialog metadata) — `overlay/access/content-frame.js`
- 🧪 Local payment-provider and suspicious-destination indicators — no credentials or card values read
- 🧪 Ad/tracker host filtering and cosmetic cleanup — opt-in to preserve Tor fingerprint parity
- 🧪 Browser packaging and startup registration — `tests/unit/test_build_tools.py`; browser smoke tests added, CI execution pending
- 📋 Full ABP/uBlock ruleset compatibility and signed local rule updates
- 📋 Controlled HTTPS + v3 onion end-to-end tests with no external onion metadata leakage

## Security & privacy
- ✅ Fingerprint parity with upstream across 500+ security prefs — `tests/integration/test_parity.py`
- ✅ Prefs-layer denylist — `tests/unit/test_prefs_policy.py`
- ✅ WebRTC unavailable — `test_webrtc_unavailable_to_content`
- ✅ No Umbra telemetry / no remote loads on Umbra pages (strict CSP)
- 🟡 Sandboxing, Fission, FPI, RFP, letterboxing, HTTPS-Only, security levels, signed extensions
- ✅ Threat model, security architecture, known limitations docs
- ✅ Contributor docs: README, CONTRIBUTING, CoC, INSTALL, BUILDING, TESTING, RELEASE, issue/PR templates

## Performance
- ✅ Benchmark harness Umbra vs upstream on identical hardware — `bench/benchmark.py`, results in `bench/results/`
- ✅ Tab unloading on low memory, on-demand session restore
- 📋 Hardware tiers (process count by RAM), measured before enabling. Content-process count is fingerprint-neutral but needs verification

## Platform modules
- ✅ Umbra Search, ✅ Umbra Explore (v1)
- ✅ Umbra Privacy dashboard (Tools → Umbra Privacy; live, read-only, local) — `tests/umbra/privacy-checks.test.mjs`, `tests/integration/test_privacy_dashboard.py`
- 🟡 Umbra Vault (bookmarks/passwords); 📋 encrypted export
- 🟡 Umbra Downloads
- 🧪 Umbra Access Engine (owner-led): packaged, starts at first window, toolbar button, local dashboard; network filtering **off by default** — `tests/integration/test_access_engine*.py`, `tests/umbra/*.test.mjs`. Local page inspection runs in every page (chrome-side, not visible to content); see `docs/UMBRA_ACCESS_ENGINE.md`
- 🧪 Umbra Source (Tools → Umbra Source): offline SecureDrop directory (24 outlets, v3-checksum-verified), opens onions in a separate `profile.umbra-source` instance at Safest, reusing the running Tor (no second tor) — `tests/unit/test_source_directory.py`, `tests/integration/test_source_module.py`. Onion reachability through the Source instance isn't tested yet (needs live Tor in CI). Windows launch isn't tested.
- 📋 Umbra Desk, Umbra Assistant — see `docs/modules/`

## Delivery
- ✅ CI workflow (unit, integration, leak, benchmark) — `.github/workflows/ci.yml`
- ✅ Release workflow (tag → build → GitHub Release with SHA256SUMS)
- ✅ Daily upstream-watch workflow
- ✅ Release notice bar: daily anonymous check over Tor, tag only, fixed link, never downloads — `tests/umbra/update-version.test.mjs`, `tests/integration/test_update_notice.py`, `tests/leak::test_update_check_goes_through_tor`
- 📋 In-app Umbra updater (needs source track for MAR signing)
