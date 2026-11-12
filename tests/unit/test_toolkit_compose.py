"""Static checks for the container toolkit: pins match the lock file and isolation is declared."""
import glob
import json
import os
import re

import pytest

yaml = pytest.importorskip("yaml")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TK = os.path.join(ROOT, "toolkit")
COMPOSE = yaml.safe_load(open(os.path.join(TK, "compose.yaml")))
LOCK = {u["url"]: u for u in json.load(open(os.path.join(TK, "upstreams.lock.json")))["upstreams"]}
SERVICES = COMPOSE["services"]


def test_every_built_tool_matches_the_lock():
    seen = 0
    for name, s in SERVICES.items():
        args = (s.get("build") or {}).get("args") or {}
        if "COMMIT" in args:
            seen += 1
            assert args["REPO"] in LOCK, (name, args["REPO"])
            assert args["COMMIT"] == LOCK[args["REPO"]]["commit"], name
    assert seen >= 6
    a = SERVICES["analysis"]["build"]["args"]
    by_name = {u["name"]: u for u in LOCK.values()}
    assert a["EXIFTOOL_COMMIT"] == by_name["exiftool"]["commit"]
    assert a["HASHDEEP_COMMIT"] == by_name["hashdeep"]["commit"]


def test_network_isolation_declared():
    assert COMPOSE["networks"]["toolkit"]["internal"] is True
    for name, s in SERVICES.items():
        nets = s.get("networks") or {}
        nets = list(nets) if isinstance(nets, (list, dict)) else []
        if name == "tor":
            assert set(nets) == {"egress", "toolkit"}
        elif name == "analysis":
            assert s["network_mode"] == "none" and not nets
        else:
            assert nets == ["toolkit"], (name, nets)
            assert "egress" not in nets


def test_hardening():
    for name, s in SERVICES.items():
        assert s.get("cap_drop") == ["ALL"], name
        assert "no-new-privileges:true" in s.get("security_opt", []), name


def test_tor_socks_is_onion_only():
    torrc = open(os.path.join(TK, "docker", "torrc")).read()
    socks = [l for l in torrc.splitlines() if l.startswith("SocksPort")]
    assert socks and all("OnionTrafficOnly" in l for l in socks)
    assert "SocksPolicy reject *" in torrc


def test_base_images_pinned_by_digest():
    for f in glob.glob(os.path.join(TK, "docker", "*.Dockerfile")):
        for line in open(f):
            if line.startswith("FROM "):
                assert re.search(r"@sha256:[0-9a-f]{64}", line), (f, line)
    for name, s in SERVICES.items():
        if "image" in s and "build" not in s:
            assert re.search(r"@sha256:[0-9a-f]{64}$", s["image"]), name
