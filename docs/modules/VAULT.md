# Umbra Vault (experimental)

**Tools → Umbra Vault (encrypted export)** opens `chrome://browser/content/umbra-vault/vault.html`. It exports bookmarks (and saved logins, if the profile stores any) to one encrypted `.umbravault` file on this device, and imports them back. There's no network access and no sync.

## Status

| Part | Status |
|---|---|
| Encrypted export and import of bookmarks | ✅ tested (`tests/integration/test_vault.py`) |
| Saved logins export and import (duplicates skipped) | ✅ tested in a profile with logins enabled |
| Default profile: logins are unavailable (Tor Browser sets `security.nocertdb=true`, `signon.rememberSignons=false`), and the page says so | ✅ tested. Vault never changes these prefs. |
| Tamper, wrong-passphrase and weak-parameter rejection | ✅ tested (`tests/umbra/vault-crypto.test.mjs`) |
| `javascript:` / `data:` / `place:` bookmarks are dropped on export and rejected on import | ✅ tested |
| age-compatible files | 📋 planned (it needs a vetted, vendored age implementation; we won't write one) |

## File format v1

```json
{ "format": "umbra-vault", "version": 1,
  "kdf":    { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<16 bytes b64>" },
  "cipher": { "name": "AES-GCM", "iv": "<12 bytes b64>" },
  "ciphertext": "<b64, includes 128-bit tag>" }
```

- Key: PBKDF2-HMAC-SHA-256 of the NFC-normalised passphrase, using a random 16-byte salt and 600,000 iterations, producing an AES-256 key.
- Encryption: AES-256-GCM with a random 12-byte IV. The AAD is a canonical JSON array of every header field, so changing any parameter makes decryption fail.
- On import, iterations must be between 100,000 and 10,000,000, which refuses downgraded or denial-of-service files.
- All primitives come from WebCrypto: NSS inside Umbra, OpenSSL under Node for tests. Umbra contains no cryptographic code of its own.
- Files are written atomically with mode 0600 on Unix.
- There's a 12-character minimum passphrase. If the passphrase is lost, the file can't be recovered.

Threat notes: anyone with the file can run offline guessing attacks at roughly PBKDF2 speed, so passphrase strength is the real protection. Vault doesn't protect data that's already in the open profile.
