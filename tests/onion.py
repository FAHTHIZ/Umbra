"""Tor v3 onion address validation (rend-spec-v3 section 6)."""
import base64
import hashlib


def is_valid_v3(host: str) -> bool:
    host = host.lower()
    if host.endswith(".onion"):
        host = host[:-6]
    label = host.split(".")[-1]
    if len(label) != 56:
        return False
    try:
        raw = base64.b32decode(label.upper())
    except Exception:
        return False
    pubkey, checksum, version = raw[:32], raw[32:34], raw[34:]
    if version != b"\x03":
        return False
    expected = hashlib.sha3_256(b".onion checksum" + pubkey + version).digest()[:2]
    return checksum == expected
