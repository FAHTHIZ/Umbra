import hashlib
import os
import zipfile

import pytest

from tools.umbra_build.branding import brand_ftl, brand_properties, icon_png
from tools.umbra_build.omni import Omni
from tools.umbra_build.build import patch_access_manifest, patch_access_omni
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



def test_access_engine_is_packaged_into_browser_omni(tmp_path):
    src = tmp_path / "browser-omni.ja"
    with zipfile.ZipFile(src, "w"):
        pass
    omni = Omni(str(src))
    patch_access_omni(omni)
    out = tmp_path / "patched-omni.ja"
    omni.save(str(out))
    with zipfile.ZipFile(out) as archive:
        names = set(archive.namelist())
        assert "modules/umbra/AccessEngine.sys.mjs" in names
        assert "modules/umbra/FilterRules.sys.mjs" in names
        assert "chrome/browser/content/browser/umbra-access/content-frame.js" in names
        assert "chrome/browser/content/browser/umbra-access/dashboard.html" in names
        assert "chrome/browser/content/browser/umbra-access/dashboard.js" in names
        assert "chrome/browser/content/browser/umbra-access/dashboard.css" in names
        assert b"UmbraAccessEngine" in archive.read("modules/umbra/AccessEngine.sys.mjs")
        dashboard = archive.read("chrome/browser/content/browser/umbra-access/dashboard.html")
        assert b"connect-src 'none'" in dashboard
        assert b"form-action 'none'" in dashboard
        frame_script = archive.read("chrome/browser/content/browser/umbra-access/content-frame.js")
        assert b"localStorage" not in frame_script
        assert b"document.cookie" not in frame_script


def test_access_filtering_is_opt_in_for_tor_fingerprint_safety():
    prefs = open(os.path.join(os.path.dirname(__file__), "..", "..", "overlay", "prefs", "umbra-prefs.js")).read()
    assert 'pref("umbra.access.enabled", false);' in prefs
    assert 'pref("umbra.access.cosmetic", false);' in prefs



def test_access_startup_manifest_registration_is_idempotent(tmp_path):
    app = tmp_path / "app"
    manifest = app / "Browser" / "components" / "BrowserComponents.manifest"
    manifest.parent.mkdir(parents=True)
    manifest.write_text("category browser-idle-startup resource:///modules/PlacesUIUtils.sys.mjs PlacesUIUtils.unblockToolbars\n")
    patch_access_manifest(str(app))
    patch_access_manifest(str(app))
    text = manifest.read_text()
    entry = "category browser-first-window-ready resource:///modules/umbra/AccessEngine.sys.mjs UmbraAccessEngine.init"
    assert text.count(entry) == 1
