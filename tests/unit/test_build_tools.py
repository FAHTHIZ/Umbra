import hashlib
import os
import zipfile

import pytest

from tools.umbra_build.branding import brand_ftl, brand_properties, icon_png
from tools.umbra_build.omni import Omni
from tools.umbra_build.verify import VerificationError, verify_sha256


def _mkzip(p):
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("a/", b"")
        z.writestr("a/x.txt", b"hello")
        z.writestr("b.png", b"\x89PNG")


def test_omni_roundtrip_is_deterministic(tmp_path):
    src = tmp_path / "o.ja"
    _mkzip(src)
    outs = []
    for i in range(2):
        o = Omni(str(src))
        o.put("a/x.txt", "changed")
        o.put("c/new.js", "1")
        dst = tmp_path / f"out{i}.ja"
        o.save(str(dst))
        outs.append(hashlib.sha256(dst.read_bytes()).hexdigest())
    assert outs[0] == outs[1]
    z = zipfile.ZipFile(tmp_path / "out0.ja")
    assert z.namelist() == ["a/", "a/x.txt", "b.png", "c/new.js"]
    assert z.read("a/x.txt") == b"changed"
    assert z.getinfo("b.png").compress_type == zipfile.ZIP_STORED


def test_omni_records_changes(tmp_path):
    src = tmp_path / "o.ja"
    _mkzip(src)
    o = Omni(str(src))
    o.put("a/x.txt", "hello")  # identical -> not a change
    o.put("a/x.txt", "x", "why")
    assert o.changed == {"a/x.txt": "modified why"}


def test_sha256_mismatch_rejected(tmp_path):
    f = tmp_path / "f"
    f.write_bytes(b"data")
    verify_sha256(str(f), hashlib.sha256(b"data").hexdigest())
    with pytest.raises(VerificationError):
        verify_sha256(str(f), "0" * 64)


def test_branding_rewrites():
    out = brand_ftl("-brand-short-name = Tor Browser\n-vendor-short-name = Tor Project\nother = keep\n")
    assert "-brand-short-name = Umbra" in out and "other = keep" in out
    assert "brandShortName=Umbra" in brand_properties("brandShortName=Tor Browser\n")


def test_icon_sizes():
    from PIL import Image
    import io
    for s in (16, 128):
        assert Image.open(io.BytesIO(icon_png(s))).size == (s, s)
