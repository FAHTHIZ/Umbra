# Testing

Every ✅ in [CHECKLIST.md](CHECKLIST.md) maps to a test here.

| Suite | Needs | What it proves |
|---|---|---|
| `tests/unit` | Python only | config validity, prefs denylist, onion checksums, deterministic build tools |
| `tests/umbra/*.test.mjs` | Node 20+ | Access Engine filter rules (`node --test tests/umbra/*.test.mjs`) |
| `tests/integration` | built `dist/`, geckodriver | real browser: default search, all providers, custom engines, home page, branding, tabs, WebRTC off, **fingerprint parity with upstream** |
| `tests/leak` | built `dist/`, geckodriver | traffic only goes to the SOCKS port; DNS stays remote; no direct fallback when Tor is down; per-site circuit isolation; leak-monitor self-test |
| `tests/live` | `UMBRA_LIVE_TOR=1` + Tor reachability | real bootstrap, check.torproject.org says "Congratulations", onion search works |

## How the leak tests work

- `socks_canary.py` is a fake SOCKS5 server that records every request: target, whether DNS was resolved locally, and the isolation username.
- `sockmon.py` reads `/proc/<pid>/net/{tcp,tcp6,udp,udp6}` for the browser's whole process tree and fails if any socket goes anywhere other than loopback.
- The self-test proves that the monitor **does** catch a deliberate direct connection, so a green result means something.

## Parity test

`test_parity.py` launches unmodified Tor Browser and Umbra with identical settings, dumps every pref in the fingerprint-relevant namespaces (`privacy.`, `network.`, `dom.`, `media.`, `webgl.`, `javascript.`, `security.`, `browser.display`, `font.`, `layout.`…), and fails on **any** difference. It also compares the navigator and screen values that content can see.

## Running in a container or CI

Use `MOZ_HEADLESS=1`, which the drivers set automatically. CI installs `libgtk-3-0t64 libdbus-glib-1-2 libasound2t64` on Ubuntu 24.04.
