#!/usr/bin/env python3
"""Regenerate overlay/home/umbraExplore.js from overlay/explore/curated-onions.json."""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
from tests.onion import is_valid_v3  # noqa: E402
from urllib.parse import urlparse  # noqa: E402

d = json.load(open(os.path.join(ROOT, "overlay/explore/curated-onions.json")))
for c in d["categories"]:
    for i in c["items"]:
        h = urlparse(i["url"]).hostname
        if h.endswith(".onion") and not is_valid_v3(h):
            sys.exit(f"invalid onion: {i['url']}")
out = os.path.join(ROOT, "overlay/home/umbraExplore.js")
open(out, "w").write('"use strict";\n// GENERATED at build time from overlay/explore/curated-onions.json. Do not edit.\n'
                     "window.UMBRA_EXPLORE = " + json.dumps({"categories": d["categories"]}, indent=1) + ";\n")
print("wrote", out)
