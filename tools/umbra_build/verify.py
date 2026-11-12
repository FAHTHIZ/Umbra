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


def verify_signature(path: str, sig: str, fingerprint: str, wkd: str) -> None:
    """Verify a detached signature in an isolated keyring.

    Requires a VALIDSIG status line whose *primary* key fingerprint equals the
    pinned fingerprint. A good signature from any other key is rejected.
    """
    fingerprint = fingerprint.replace(" ", "").upper()
    with tempfile.TemporaryDirectory() as home:
        env = dict(os.environ, GNUPGHOME=home)
        subprocess.run(["gpg", "--batch", "--quiet", "--auto-key-locate", "nodefault,wkd",
                        "--locate-keys", wkd], env=env, check=True, capture_output=True)
        r = subprocess.run(["gpg", "--batch", "--status-fd", "1", "--verify", sig, path],
                           env=env, capture_output=True, text=True)
        for line in r.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 2 and parts[1] == "VALIDSIG":
                primary = parts[-1].upper()
                if primary == fingerprint and r.returncode == 0:
                    return
                raise VerificationError(f"Signed by unexpected key {primary}")
        raise VerificationError("No valid signature: " + (r.stderr.strip()[-400:] or "unknown"))
