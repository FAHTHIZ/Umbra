# Security architecture

What protects Umbra users, where it comes from, and how each control is verified.

| Control | Provided by | Umbra verification |
|---|---|---|
| Process sandboxing (content, socket, RDD, utility, GPU processes; seccomp-bpf + namespaces on Linux) | Gecko / Tor Browser | Observed process types in benchmark runs; upstream test suites |
| Site isolation (Fission) | Gecko | Parity test: `fission.*` prefs identical to upstream |
| First-party isolation of cookies, cache, storage, TLS session state | Tor Browser | Parity test (`privacy.*`) |
| Per-site Tor circuits | Tor Browser SOCKS credentials | `tests/leak::test_circuit_isolation_per_first_party` |
| All traffic through Tor, remote DNS | Tor Browser proxy config + bypass hardening | `tests/leak::test_all_traffic_goes_through_socks_with_remote_dns` |
| No direct fallback when Tor is down | Tor Browser | `tests/leak::test_fail_closed_when_tor_proxy_is_down` |
| WebRTC disabled | Tor Browser | `tests/integration::test_webrtc_unavailable_to_content` |
| Anti-fingerprinting (RFP, letterboxing, fonts, UA) | Tor Browser | Parity test across 500+ prefs; prefs-layer denylist |
| HTTPS-Only mode | Tor Browser default | Parity test |
| Certificate validation (NSS, CRLite/OneCRL data bundled) | Gecko | Parity test (`security.*`) |
| Signed extensions only | Gecko | Parity test (`xpinstall.*`) |
| No telemetry, studies, or Pocket | Tor Browser build flags + prefs | Parity test; no Umbra network code |
| Supply-chain verification | Umbra build tool | `tests/unit/test_build_tools.py`, signature check every build |
| Deterministic outputs | Umbra build tool | `test_omni_roundtrip_is_deterministic` |
| Security levels (Standard/Safer/Safest) | Tor Browser | Linked from the Umbra home page |

## Rules for contributors

1. Never change a pref in a denylisted namespace (`tests/unit/test_prefs_policy.py`) without a security review documented in `docs/IDEAS.md`.
2. Never add network requests to Umbra UI pages. Home and Explore are local only.
3. Source patches go in `overlay/patches/patches.json` and must be anchored (exact single match).
4. Never ship `distribution/policies.json`. It changes the web-visible fingerprint.
5. New onion addresses must come from the operator's own announcement and pass the v3 checksum test.
