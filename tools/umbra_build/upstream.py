"""Detect new upstream Tor Browser releases (used by the upstream-watch CI job)."""
import json
import urllib.request

from .build import load_lock

FEED = "https://aus1.torproject.org/torbrowser/update_3/release/download-linux-x86_64.json"


def check() -> dict:
    with urllib.request.urlopen(FEED, timeout=30) as r:
        data = json.load(r)
    current = load_lock()["version"]
    latest = data.get("version")
    return {"pinned": current, "latest": latest, "binary": data.get("binary"), "sig": data.get("sig"),
            "update_available": bool(latest) and latest != current}
