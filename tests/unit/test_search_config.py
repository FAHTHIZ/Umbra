import json
import os
from urllib.parse import urlparse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CFG = json.load(open(os.path.join(ROOT, "overlay/search/umbra-search-engines.json")))
ENGINES = [e for e in CFG if e.get("recordType") == "engine"]


def test_default_is_onionsearch_normal_and_private():
    d = next(e for e in CFG if e.get("recordType") == "defaultEngines")
    assert d["globalDefault"] == "onionsearch"
    assert d["globalDefaultPrivate"] == "onionsearch"


def test_required_providers_present():
    names = {e["base"]["name"] for e in ENGINES}
    for n in ["OnionSearch", "DuckDuckGo", "Google", "Brave Search", "Startpage", "Ecosia"]:
        assert n in names


def test_order_lists_every_engine_once():
    order = next(e for e in CFG if e.get("recordType") == "engineOrders")["orders"][0]["order"]
    ids = [e["identifier"] for e in ENGINES]
    assert sorted(order) == sorted(ids) and len(set(order)) == len(order)
    assert order[0] == "onionsearch"


def test_clearnet_engines_use_https_only():
    for e in ENGINES:
        for kind, u in e["base"]["urls"].items():
            p = urlparse(u["base"])
            if not p.hostname.endswith(".onion"):
                assert p.scheme == "https", f"{e['identifier']} {kind} must be https"


def test_unique_ids_and_aliases():
    ids = [e["id"] for e in ENGINES]
    assert len(ids) == len(set(ids))
    aliases = [a for e in ENGINES for a in e["base"]["aliases"]]
    assert len(aliases) == len(set(aliases))
