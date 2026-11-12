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


PINNED_KEY = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "upstream", "keys", "torbrowser.asc"))

_MSYS = None


def _is_msys_gpg() -> bool:
    """Git for Windows ships an MSYS2 gpg that wants POSIX-style paths (/d/a/x)."""
    global _MSYS
    if _MSYS is None:
        _MSYS = False
        if os.name == "nt":
            try:
                out = subprocess.run(["gpg", "--version"], capture_output=True, text=True).stdout
                _MSYS = "Home: /" in out
            except OSError:
                pass
    return _MSYS


def gpg_path(p: str) -> str:
    """Path as the gpg binary expects it (pure; MSYS form when needed)."""
    p = os.path.abspath(p)
    if _is_msys_gpg() and len(p) > 1 and p[1] == ":":
        return "/" + p[0].lower() + p[2:].replace("\\", "/")
    return p


def _gpg(home, *args, **kw):
    return subprocess.run(["gpg", "--homedir", gpg_path(home), "--batch", *args], capture_output=True, text=True, **kw)


def _check(r, what):
    if r.returncode != 0:
        raise VerificationError(f"gpg {what} failed ({r.returncode}): {r.stderr.strip()[-600:]}")


def _gpg_verify(home, sig, path, fingerprint):
    r = _gpg(home, "--status-fd", "1", "--verify", gpg_path(sig), gpg_path(path))
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
        err = ""
        if os.path.isfile(pinned_key):
            _check(_gpg(home, "--quiet", "--import", gpg_path(pinned_key)), "import of pinned key")
            ok, err = _gpg_verify(home, sig, path, fingerprint)
            if ok:
                return
        r = _gpg(home, "--quiet", "--auto-key-locate", "nodefault,wkd", "--locate-keys", wkd)
        if r.returncode != 0:
            raise VerificationError(f"No valid signature with pinned key ({err}); WKD refresh failed: {r.stderr.strip()[-300:]}")
        ok, err = _gpg_verify(home, sig, path, fingerprint)
        if ok:
            return
        raise VerificationError("No valid signature: " + err)
