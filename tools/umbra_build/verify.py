"""Supply-chain verification of upstream artifacts (OpenPGP + pinned SHA-256)."""
from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile


class VerificationError(RuntimeError):
    pass


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_sha256(path: str, expected: str) -> None:
    got = sha256_file(path)
    if got.lower() != expected.lower():
        raise VerificationError(f"SHA-256 mismatch for {os.path.basename(path)}: expected {expected}, got {got}")


PINNED_KEY = os.path.join(os.path.dirname(__file__), "..", "..", "upstream", "keys", "torbrowser.asc")


def _gpg_verify(env, sig, path, fingerprint):
    r = subprocess.run(["gpg", "--batch", "--status-fd", "1", "--verify", sig, path],
                       env=env, capture_output=True, text=True)
    for line in r.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "VALIDSIG":
            primary = parts[-1].upper()
            if primary == fingerprint and r.returncode == 0:
                return True, ""
            raise VerificationError(f"Signed by unexpected key {primary}")
    return False, (r.stderr.strip()[-400:] or "unknown")


def verify_signature(path: str, sig: str, fingerprint: str, wkd: str, pinned_key: str = PINNED_KEY) -> None:
    """Verify a detached signature in an isolated keyring.

    Requires a VALIDSIG status line whose *primary* key fingerprint equals the
    pinned fingerprint, so a good signature from any other key is rejected.
    Keys come from the copy in upstream/keys/ (works offline and with gpg
    builds that lack WKD support). If that copy predates a signing-subkey
    rotation, the key is refreshed over WKD and the check is retried. Either
    way the trust anchor is the pinned fingerprint, not the key file.
    """
    fingerprint = fingerprint.replace(" ", "").upper()
    with tempfile.TemporaryDirectory() as home:
        env = dict(os.environ, GNUPGHOME=home)
        if os.path.isfile(pinned_key):
            subprocess.run(["gpg", "--batch", "--quiet", "--import", pinned_key], env=env, check=True, capture_output=True)
            ok, err = _gpg_verify(env, sig, path, fingerprint)
            if ok:
                return
        subprocess.run(["gpg", "--batch", "--quiet", "--auto-key-locate", "nodefault,wkd",
                        "--locate-keys", wkd], env=env, check=True, capture_output=True)
        ok, err = _gpg_verify(env, sig, path, fingerprint)
        if ok:
            return
        raise VerificationError("No valid signature: " + err)
