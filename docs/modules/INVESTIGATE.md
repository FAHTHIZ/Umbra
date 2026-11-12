# Umbra Investigate (experimental)

Umbra Investigate is a separate, **onion-only** browser instance for manual investigation of
onion services. It has read-only page inspection, local evidence capture with SHA-256 hash
chains, and exports that standard forensic tools can read. Third-party command-line tools run
next to it in isolated containers (see [toolkit/README.md](../../toolkit/README.md)).

You drive it like a normal browser. Investigate never logs in, registers, solves CAPTCHAs,
pays, or submits forms. When a page has a login form, a CAPTCHA, a payment request or an access
restriction, the inspection panel **explains** it and leaves it alone.

## Opening it

- **Umbra menu → Investigate**, or **Tools → Umbra Investigate**, in the normal Umbra window.
- The launcher page asks for an onion address. Only `http(s)://<56-character v3>.onion`
  addresses are accepted. Anything else gives "Investigate only opens onion services".
- Umbra starts a second Gecko process:
  `--new-instance --profile <profiles>/profile.umbra-investigate`, with `TOR_PROVIDER=none`.
  It reuses the main window's Tor and never starts a second tor.

The Investigate profile's `user.js` is rewritten on every launch, so its settings cannot drift.
It sets:

- the Safest security level and always-private browsing;
- remote DNS through SOCKS, with no direct failover;
- no speculative connections, predictor, prefetch or DNS prefetch;
- no saved passwords;
- the Umbra release check and Access Engine turned off;
- the Investigate dashboard as the home page.

## Onion-only guard

Implemented in `overlay/investigate/UmbraInvestigate.sys.mjs`, with the decision logic in
`investigate-core.mjs`. Both run only when `umbra.investigate.mode` is true, which is only in the
Investigate profile.

| Layer | Mechanism | What it catches |
|---|---|---|
| 1. Request observer | `http-on-opening-request` and `http-on-modify-request` cancel every non-onion HTTP(S)/WS channel before it connects | Top-level navigations, subresources (img, css, script, frames), WebSocket upgrades, beacons |
| 2. Proxy blackhole | A proxy channel filter at position 1 (after Tor Browser's isolation filter at 0) sends any non-onion channel to `socks://127.0.0.1:9`, which refuses. The channel is cancelled and logged with `layer: proxy-blackhole` | Anything layer 1 did not see. In testing this was redirect targets, whose proxy is resolved during redirect setup |
| Explanation page | Blocked top-level loads show `blocked.html` with the URL, the reason, and for redirects the onion page that redirected (`from=`). A progress listener re-applies it if the network error page tries to replace it | User-visible, never a silent failure |

Allowed: `.onion` hosts on `http`, `https`, `ws` and `wss`, plus browser-internal schemes
(`about:`, `chrome:`, `resource:`, `moz-extension:`, `blob:`, `data:`).

**Tor bootstrap and bridges** (including Moat) are handled by the main instance's tor process,
not by Gecko in the Investigate instance. So the guard needs **no clearnet exception at all**.
Background Tor Browser fetches, such as the SecureDrop HTTPS-Everywhere ruleset at
`securedrop.org`, are blocked in Investigate and appear in the traffic log.

**Search:** OnionSearch.io is a clearnet site, so it is blocked here. The default search in
Investigate is **DuckDuckGo (.onion)**. The dashboard also searches Ahmia's and Brave Search's
onion services. The normal Umbra window still uses OnionSearch.io as its default.

## Inspection (read-only)

"Inspect this page" walks the live DOM in the content process
(`UmbraInvestigateChild.sys.mjs`). It reports:

- login, registration, CAPTCHA (reCAPTCHA, hCaptcha, Turnstile and generic forms), payment and
  checkout forms;
- access restrictions, from HTTP 401/402/403/407/451/429 statuses and page text;
- cryptocurrency addresses (BTC, including bech32, plus ETH and XMR patterns);
- clearnet references (which the guard would block);
- onion links, collected as leads.

It records form structure: field types, names and actions. It **never reads field values**. It
makes no network requests and submits nothing.

## Cases and evidence

Cases are stored under `<Investigate profile>/umbra-cases/<case-id>/`. The directory is mode 0700
and every file is 0600 on Unix.

| File | Content |
|---|---|
| `manifest.json` | Every artifact with its path, kind, size, SHA-256, capture id, URL and time |
| `case-log.jsonl` | Append-only log. Each entry has `seq`, `prev` (the previous entry's hash), `hash = SHA-256(canonical JSON of the entry)`, `time`, `type` and `data` |
| `artifacts/NNNN-<kind>.<ext>` | Write-once. A capture produces `dom` (serialized live DOM), `screenshot` (PNG of the viewport), `headers`, `inspection`, `traffic` (HAR 1.2, metadata only, no bodies) and `capture` (versions, guard status, times, URL and references to the other five) |
| `hashdeep.txt` | hashdeep/md5deep-format manifest. Audit it with `cd artifacts && hashdeep -c sha256 -a -k ../hashdeep.txt -l -r .` |
| `timesketch.jsonl` | Timesketch JSONL (`message`, `datetime`, `timestamp_desc`, `data_type`) for import into Timesketch |

The HAR redacts `Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization` and similar
headers. Leads can be imported as pasted text, a TorBot JSON file or an OnionSearch CSV. Only
`.onion` links are kept, and the raw import is stored as a hashed artifact.

**Encryption:** "Encrypt case" writes `<case-id>.umbracase`, the whole case sealed with Umbra
Vault v1 (PBKDF2-SHA256 with 600,000 iterations, then AES-256-GCM). If you ask for the plaintext
to be removed, Umbra first decrypts the bundle and compares every file. It deletes the plaintext
only if they match.

### What the evidence is and is not

- `dom` is the **live, serialized DOM** at capture time. It is not the original response bytes.
  Scripts are off at the Safest level, so it is usually close to the original.
- `screenshot` covers the **viewport only**, not the full page.
- Times come from the **local clock**. This is not trusted timestamping (no RFC 3161).
- The hash chain shows that entries were not changed or removed **after** they were written. It
  cannot prove that the machine was trustworthy when they were written.
- Unless you encrypt it, case data is **plaintext** in the profile, protected only by file
  permissions.
- Captures are a lead-generation and documentation aid, not a forensic certification.

### Offline tools (`tools/investigate/`)

All of these are standard-library Python. Decryption also needs `cryptography`.

```bash
python3 -m tools.investigate.verify_case <case-dir> [--hashdeep]
python3 -m tools.investigate.verify_case --bundle <id>.umbracase --extract-to <dir>   # passphrase: $UMBRA_CASE_PASSPHRASE or prompt
python3 -m tools.investigate.attach <case-dir> report.json --tool onionscan --tool-version <commit>
python3 -m tools.investigate.analyze_case <case-dir>      # exiftool + mitmproxy HAR reader, results added as artifacts
```

The Python verifier reproduces the browser's canonical JSON and hash chain byte for byte. This is
checked in `tests/unit/test_caselib.py`. It also flags files that are present but not listed in
the manifest.

## Status

| Part | Status |
|---|---|
| Separate instance, profile prefs, onion-only launcher | ✅ tested (Linux) |
| Guard layer 1 and layer 2, explanation page, redirect origin | ✅ tested (integration and leak tests) |
| No direct sockets, no local DNS, remote names only, fail-closed with the proxy down | ✅ tested (`tests/leak/test_investigate_leaks.py`, `/proc` socket monitor) |
| Inspection: login, CAPTCHA, crypto, access restriction, never reads values, no requests | ✅ tested |
| Traffic log with header redaction | ✅ tested |
| Capture, hash chain, verification, tamper detection (JS and Python) | ✅ tested |
| hashdeep audit, mitmproxy HAR read, exiftool analysis of real captures | ✅ tested with the real tools |
| Timesketch JSONL | ✅ format tested. Not imported into a live Timesketch server |
| Encrypted bundles (browser → Python decryption) | ✅ tested |
| Live onion browsing over real Tor | ✅ tested in the `live-tor` CI job (`tests/live/test_investigate_live.py`): Tor bootstraps with the guard on, an onion service loads, a clearnet page is blocked. Non-gating, because Tor reachability varies |
| Windows and macOS launch | ⚠️ untested |
| Mobile | 📋 planned |
| Full-page screenshots, original response bytes, RFC 3161 timestamps | 📋 planned |

## Tests

- `tests/umbra/investigate-core.test.mjs` covers the guard decisions, HAR, hashing, chain, leads,
  classifier and naming.
- `tests/integration/test_investigate.py` runs the launcher, guard and dashboard flow end to end,
  including the real hashdeep, mitmproxy and exiftool.
- `tests/leak/test_investigate_leaks.py` checks that only onion hosts reach the proxy, with no
  direct sockets and no UDP/53.
- `tests/unit/test_caselib.py` covers JS/Python format parity and tamper detection.
- `tests/unit/test_toolkit_compose.py` and `toolkit/selftest.sh` cover container isolation.
