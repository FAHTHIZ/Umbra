"""The bundled SecureDrop directory contains only valid v3 onion addresses."""
import base64
import hashlib
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
DIR = json.load(open(os.path.join(ROOT, "overlay", "source", "securedrop-directory.json")))


def v3_ok(host):
    if not host.endswith(".onion") or len(host) != 62:
        return False
    raw = base64.b32decode(host[:-6].upper())
    pub, chk, ver = raw[:32], raw[32:34], raw[34:]
    return ver == b"\x03" and hashlib.sha3_256(b".onion checksum" + pub + ver).digest()[:2] == chk


def test_directory_shape():
    assert DIR["count"] == len(DIR["entries"]) > 0
    assert "Freedom of the Press Foundation" in DIR["attribution"]
    slugs = [e["slug"] for e in DIR["entries"]]
    assert len(set(slugs)) == len(slugs)


def test_all_onions_v3_checksum_valid():
    for e in DIR["entries"]:
        assert v3_ok(e["onion"]), e["title"]


def test_no_clearnet_links_in_page():
    html = open(os.path.join(ROOT, "overlay", "source", "source.html")).read()
    assert "http://" not in html and "https://" not in html
