# Umbra Source (experimental)

**Tools → Umbra Source (SecureDrop)** opens `chrome://browser/content/umbra-source/source.html`, a local page that helps people reach a news organisation's **SecureDrop** onion service from an isolated Umbra instance.

Umbra does **not** implement its own submission system and never sends anything itself. SecureDrop is audited, purpose-built software from the Freedom of the Press Foundation, so we link to it and don't reinvent it.

## What's implemented

| Part | Status |
|---|---|
| Offline SecureDrop directory (bundled snapshot, filterable by name, country, language, topic) | ✅ tested |
| Every bundled address is a checksum-valid v3 onion (verified at generation time and in unit tests) | ✅ tested |
| Safety guidance (Tails for high-risk sources, metadata, codename, work devices) | ✅ |
| Separate instance: `--new-instance --profile <profiles>/profile.umbra-source` | ✅ tested on Linux |
| Source profile prefs: Safest security level, always-private browsing, remote DNS, no direct failover, Umbra release check and Access Engine off | ✅ tested |
| Reuses the main instance's Tor SOCKS endpoint (`TOR_PROVIDER=none`, so a second tor is never started). Fails closed if Tor stops. | ✅ (code path tested; live onion load not yet tested in CI) |
| Opens only `http(s)://<56-char v3>.onion` targets | ✅ tested |
| Windows launch | ⚠️ untested |
| Refreshing the directory from inside the browser | 📋 planned (it currently updates with each Umbra release) |

## Isolation model

The Source instance is a separate Gecko process with its own profile directory next to the main profile. It shares no cookies, history, storage, permissions, downloads, session or Desk notes with normal browsing. Its `user.js` is rewritten on every launch, so the settings can't drift.

It uses the **same Tor daemon** as the main window. Tor Browser's SOCKS isolation gives it separate circuits per first-party domain. A network observer can still see that you use Tor (bridges help). Using Tor doesn't guarantee anonymity: see [THREAT_MODEL.md](../THREAT_MODEL.md).

**For high-risk sources, use Tails**, on a device that isn't your work computer and on a network that isn't your home or workplace. Umbra running on your everyday operating system can't protect you from malware, monitoring software or physical access to that device.

## Updating the directory

```sh
python3 tools/gen_securedrop.py   # fetches https://securedrop.org/api/v1/directory/, validates every onion, writes overlay/source/securedrop-directory.json
```

Review the diff, run `python3 -m pytest tests/unit/test_source_directory.py`, then commit. The page asks people to cross-check the address against the organisation's own website.

Directory data: [SecureDrop directory](https://securedrop.org/directory/), Freedom of the Press Foundation.
