#!/usr/bin/env python3
"""Snapshot the official SecureDrop directory into overlay/source/securedrop-directory.json.

Source: https://securedrop.org/api/v1/directory/ (Freedom of the Press Foundation).
Run manually (or from CI) and commit the result. The browser never fetches it:
Umbra Source works offline and leaks nothing about which outlets a user looks at.

Every onion address is checked for a valid v3 checksum; entries whose latest
scan isn't live, or whose address is invalid, are dropped.
"""
import datetime as dt
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from tests.onion import is_valid_v3  # noqa: E402

API = "https://securedrop.org/api/v1/directory/"
OUT = os.path.join(ROOT, "overlay", "source", "securedrop-directory.json")


def fetch():
    req = urllib.request.Request(API, headers={"Accept": "application/json", "User-Agent": "umbra-build"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def normalise(entries):
    out, dropped = [], []
    for e in entries:
        onion = (e.get("onion_address") or "").strip().lower()
        live = (e.get("latest_scan") or {}).get("live")
        if not onion or not is_valid_v3(onion) or live is False:
            dropped.append(e.get("title"))
            continue
        out.append({
            "title": e["title"].strip(),
            "slug": e["slug"],
            "onion": onion,
            "onion_name": e.get("onion_name") or None,
            "description": (e.get("organization_description") or "").strip()[:240],
            "languages": sorted(e.get("languages") or []),
            "countries": sorted(c for c in (e.get("countries") or []) if c != "All countries"),
            "topics": sorted(e.get("topics") or []),
            "landing_page_url": e.get("landing_page_url"),
            "directory_url": e.get("directory_url"),
        })
    out.sort(key=lambda x: x["title"].lower())
    return out, dropped


def main():
    entries, dropped = normalise(fetch())
    data = {
        "source": API,
        "attribution": "SecureDrop directory by Freedom of the Press Foundation (securedrop.org)",
        "generated": dt.date.today().isoformat(),
        "count": len(entries),
        "entries": entries,
    }
    with open(OUT, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(entries)} entries to {OUT}; dropped {len(dropped)}: {dropped}")


if __name__ == "__main__":
    main()
