import json
import os
from urllib.parse import urlparse

from tests.onion import is_valid_v3

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _urls():
    d = json.load(open(os.path.join(ROOT, "overlay/explore/curated-onions.json")))
    for c in d["categories"]:
        for i in c["items"]:
            yield i["url"]
    for e in json.load(open(os.path.join(ROOT, "overlay/search/umbra-search-engines.json"))):
        if e.get("recordType") == "engine":
            yield e["base"]["urls"]["search"]["base"]


def test_every_onion_address_has_valid_v3_checksum():
    onions = [u for u in _urls() if urlparse(u).hostname.endswith(".onion")]
    assert len(onions) >= 10
    bad = [u for u in onions if not is_valid_v3(urlparse(u).hostname)]
    assert not bad, f"invalid onion addresses: {bad}"


def test_checksum_detects_typo():
    good = "duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion"
    assert is_valid_v3(good)
    assert not is_valid_v3(good.replace("gogg", "gogh"))
    assert not is_valid_v3("expyuzz4wqqyqhjn.onion")  # v2, deprecated


def test_generated_explore_js_in_sync():
    d = json.load(open(os.path.join(ROOT, "overlay/explore/curated-onions.json")))
    js = open(os.path.join(ROOT, "overlay/home/umbraExplore.js")).read()
    for c in d["categories"]:
        for i in c["items"]:
            assert i["url"] in js, "run tools/gen_explore.py"
