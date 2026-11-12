# Umbra investigation toolkit

Third-party investigation tools, pinned to exact upstream commits and kept **outside the
browser**. Umbra Investigate (the onion-only browser instance) does the manual browsing,
inspection and evidence capture. This toolkit runs the command-line tools next to it, isolated
in containers, and feeds their output back into a case.

- `upstreams.lock.json` lists every upstream project with its commit, license and how Umbra uses it.
- `fetch_upstreams.py` checks out each pin and verifies `HEAD` matches it (`--check` only validates the lock).
- `compose.yaml` and `docker/` hold the isolated tool containers.
- `selftest.sh` proves the isolation claims below. CI runs it in the `toolkit` job.

Only use these tools against services you operate or are authorised to assess. Nothing here
logs in, brute-forces, bypasses authentication or payment, or submits forms. Umbra adds no such
capability.

## Isolation model

| Layer | What it does | Verified by |
|---|---|---|
| `toolkit` network, `internal: true` | Tool containers have no route to the internet and no public DNS | `selftest.sh`: direct connect to 1.1.1.1 and resolving example.com both fail |
| Tor `SocksPort … OnionTrafficOnly` | The only way out, Tor's SOCKS port, refuses every non-`.onion` destination, so the tools are onion-only like the browser | `selftest.sh` (live): a SOCKS connect to example.com is refused |
| `SocksPolicy accept 172.30.90.0/24` | Only the toolkit network can use the port | config, `tests/unit/test_toolkit_compose.py` |
| `IsolateDestAddr IsolateSOCKSAuth` | Each onion service gets its own circuit | config |
| `analysis` with `network_mode: none` | Offline analysis has no network at all | `selftest.sh` |
| Hardening | Non-root user, `cap_drop: ALL`, `no-new-privileges`, read-only root filesystem | `tests/unit/test_toolkit_compose.py` |
| Pins | Images are built from the commits in the lock file (the build checks `git rev-parse HEAD`). Base images are pinned by digest | `tests/unit/test_toolkit_compose.py` |

Several upstream tools hard-code `127.0.0.1:9050`. Rather than patching them, each container
runs a small `socat` forwarder (`docker/forward.sh`) from its own `127.0.0.1:9050` to the Tor
container.

**What this does not protect against:** a malicious upstream tool can still read whatever you
mount into it (`./out`, `./cases`). The tools see onion content you point them at, and Tor's
guarantees and limits apply as usual. Running through Tor does not by itself make an
investigation anonymous.

## Use

```bash
docker compose -f toolkit/compose.yaml up -d --wait tor          # bootstrap the onion-only Tor client
docker compose -f toolkit/compose.yaml run --rm onionsearch --engines ahmia --limit 1 "query"
docker compose -f toolkit/compose.yaml run --rm torbot -u http://<onion>/ --depth 1 --save json
docker compose -f toolkit/compose.yaml run --rm onionscan <onion>
docker compose -f toolkit/compose.yaml run --rm onionscout <onion>
docker compose -f toolkit/compose.yaml run --rm darkdump -q "query"
docker compose -f toolkit/compose.yaml down
```

Output lands in `toolkit/out/`. To bring it into a case:

- **Leads:** OnionSearch CSV, TorBot JSON and darkdump output can be imported on the Investigate
  dashboard under "Import leads". Only `.onion` links are kept. Each import is stored as a hashed
  artifact.
- **Reports:** `python3 -m tools.investigate.attach <case-dir> toolkit/out/report.json --tool onionscan --tool-version <commit>`
  copies the file into the case, hashes it and records the tool and version in the hash-chained log.

Offline analysis of a case (copy or export it to `toolkit/cases/` first):

```bash
docker compose -f toolkit/compose.yaml run --rm analysis tools.investigate.verify_case /cases/<case> --hashdeep
docker compose -f toolkit/compose.yaml run --rm analysis tools.investigate.analyze_case /cases/<case>
```

`analyze_case` runs exiftool (pinned commit) over screenshots and attachments, and reads every HAR
with mitmproxy's own HAR loader. Each result is added as a new hashed artifact. The case is
verified before and after.

## Status per service

| Service | Upstream | Status |
|---|---|---|
| tor | Tor Project Debian repository (key pinned by fingerprint) | Tested in CI (`selftest.sh`): bootstraps on the live network, refuses clearnet ("Connection not allowed by ruleset"), reaches an onion service |
| analysis | exiftool and hashdeep built from pinned commits, mitmproxy 12.3.1 | Tested in CI (`selftest.sh`) |
| onionsearch | megadose/OnionSearch | Image built and isolation tested in CI. Search output depends on third-party onion engines |
| torbot, darkdump, onionscout | pinned commits | Built from the pinned commit in CI and `--help` runs in the hardened container. Not yet run against an onion service in CI |
| onionscan | nao1215/onionscan (Go) | Built from the pinned commit in CI and `--help` runs. Not yet run against an onion service in CI |
| darkspider | **Unresolved**: the URL in the brief does not exist. PROxZIMA/DarkSpider is a candidate | Image builds from the pinned commit 44835a0d and `--help` runs under a pty (CI). Upstream identity still unconfirmed |
| zap | Official `zaproxy/zap-stable` image pinned by digest (not built from the pinned source commit) | **Experimental**, not tested. Baseline (passive) scan only |

Tools that are not containerised (AIL, Timesketch server, Plaso, Autopsy, The Sleuth Kit, OWASP
PTK) stay standalone. Umbra produces formats they read (Timesketch JSONL, hashdeep manifests,
HAR). See `upstreams.lock.json` for the notes on each.
