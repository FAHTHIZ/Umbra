# Building Umbra

Umbra currently uses the **overlay track**. The build downloads the official, signed Tor Browser release, verifies it, applies the files from `overlay/`, and repacks it. It never compiles Gecko, so a build takes seconds instead of hours. Why this approach: [FOUNDATION_DECISION.md](FOUNDATION_DECISION.md).

## Requirements

- Python 3.10+
- `gpg` (signature verification) and `xz`
- Windows target: 7-Zip (`7z`) to unpack the upstream NSIS portable installer. It runs on Linux or Windows hosts.
- About 1 GB of free disk space
- For tests: GTK 3 runtime libraries and [geckodriver 0.36+](https://github.com/mozilla/geckodriver/releases)

## Commands

```bash
python -m tools.umbra_build fetch        # download + verify upstream into .cache/
python -m tools.umbra_build build        # fetch, verify, overlay, package -> dist/
python -m tools.umbra_build build --no-package   # skip tar.xz (faster dev loop)
python -m tools.umbra_build build --platform linux-aarch64
python -m tools.umbra_build build --platform windows-x86_64   # -> umbra-<ver>-windows-x86_64.zip
```

Output: `dist/umbra-<ver>-linux-x86_64/` (runnable), `dist/umbra-<ver>-linux-x86_64.tar.xz` and `dist/SHA256SUMS`.

## Verification chain

1. `upstream/tor-browser.lock.json` pins the version, URL, **SHA-256** and the **signing key fingerprint**.
2. The archive must match the SHA-256 **and** have a valid OpenPGP signature whose primary key equals the pinned fingerprint. The key comes from `upstream/keys/torbrowser.asc`, with a WKD refresh if Tor rotates the signing subkey. The fingerprint, not the key file, is the trust anchor. Either failure aborts the build.
3. `omni.ja` is rewritten deterministically (sorted entries, fixed timestamps), so the same inputs produce byte-identical outputs.

## What the overlay changes

| Overlay | Target inside the bundle |
|---|---|
| `overlay/search/umbra-search-engines.json` | search engine configuration in `omni.ja` |
| `overlay/home/*` | `about:tor` home page files in `browser/omni.ja` |
| `overlay/prefs/umbra-prefs.js` | `browser/defaults/preferences/` (non-fingerprintable prefs only) |
| `overlay/patches/patches.json` | anchored find/replace on upstream JS (build fails on drift) |
| branding (generated) | icons, `application.ini` names, desktop file |

## Bumping upstream

```bash
python tools/bump_upstream.py 16.0.2     # rewrites the lock after verifying the new signature
python -m tools.umbra_build build && python -m pytest tests
```

The daily `upstream-watch` workflow opens an issue when a new Tor Browser release appears. Security releases should ship within 24 hours.
