#!/usr/bin/env python3
"""Bump the pinned upstream Tor Browser version.

Downloads the new artifact + signature, verifies the OpenPGP signature against
the pinned key, and only then records the new SHA-256 in the lock file.
Usage: python tools/bump_upstream.py 16.0.2
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from tools.umbra_build.verify import sha256_file, verify_signature  # noqa: E402

LOCK = os.path.join(ROOT, "upstream", "tor-browser.lock.json")


def main(v):
    lock = json.load(open(LOCK))
    base = f"https://dist.torproject.org/torbrowser/{v}/"
    cache = os.path.join(ROOT, ".cache")
    os.makedirs(cache, exist_ok=True)
    for plat, art in lock["artifacts"].items():
        fn = art["file"].replace(lock["version"], v)
        p = os.path.join(cache, fn)
        for suffix in ("", ".asc"):
            subprocess.run(["curl", "-sSfL", "--proto", "=https", "-o", p + suffix, base + fn + suffix], check=True)
        verify_signature(p, p + ".asc", lock["signing_key_fingerprint"], lock["signing_key_wkd"])
        art["file"] = fn
        art["sha256"] = sha256_file(p)
        print(f"{plat}: {fn} verified, sha256 {art['sha256']}")
    lock["version"] = v
    lock["base_url"] = base
    json.dump(lock, open(LOCK, "w"), indent=2)
    open(LOCK, "a").write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
