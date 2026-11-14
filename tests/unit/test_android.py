"""Android overlay: pure transformations (no APK download needed)."""
import json
import os
import re
import xml.dom.minidom

import pytest

from tools.umbra_build import android

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")

MANIFEST = """<?xml version="1.0" encoding="utf-8" standalone="no"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" android:sharedUserId="org.torproject.torbrowser.sharedID" package="org.torproject.torbrowser">
    <permission android:name="org.torproject.torbrowser.permission.PROFILER_INTERNAL" android:protectionLevel="signature"/>
    <permission android:name="org.torproject.torbrowser.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" android:protectionLevel="signature"/>
    <uses-permission android:name="org.torproject.torbrowser.permission.PROFILER_INTERNAL"/>
    <application android:name="org.mozilla.fenix.FenixApplication">
        <activity-alias android:name="org.torproject.torbrowser.App" android:targetActivity="org.mozilla.fenix.HomeActivity"/>
        <provider android:authorities="org.torproject.torbrowser.fileprovider" android:name="androidx.core.content.FileProvider"/>
        <provider android:authorities="org.torproject.torbrowser.androidx-startup" android:name="androidx.startup.InitializationProvider"/>
    </application>
</manifest>
"""


def test_manifest_moves_runtime_ids_and_keeps_component_names():
    out = android.patch_manifest(MANIFEST)
    assert 'android:sharedUserId="org.umbra.browser.sharedID"' in out
    assert 'android:authorities="org.umbra.browser.fileprovider"' in out
    assert 'android:authorities="org.umbra.browser.androidx-startup"' in out
    assert 'android:name="org.umbra.browser.permission.PROFILER_INTERNAL"' in out
    assert 'android:name="org.umbra.browser.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"' in out
    # component names and the package attribute (renamed by aapt2) stay
    assert 'android:name="org.torproject.torbrowser.App"' in out
    assert 'package="org.torproject.torbrowser"' in out
    assert 'android:name="org.mozilla.fenix.FenixApplication"' in out
    xml.dom.minidom.parseString(out)


def test_manifest_drift_fails_loudly():
    with pytest.raises(android.AndroidBuildError):
        android.patch_manifest(MANIFEST.replace('package="org.torproject.torbrowser"', 'package="org.example"'))


def test_apktool_yml_rename_and_version():
    yml = "version: 2.12.1\npackageInfo:\n  forcedPackageId: 127\nversionInfo:\n  versionCode: 1\n  versionName: 16.0.1 (153.7.0esr)\n"
    out = android.patch_apktool_yml(yml, "0.1.0 (Tor Browser 16.0.1)")
    assert "renameManifestPackage: org.umbra.browser" in out
    assert "versionName: 0.1.0 (Tor Browser 16.0.1)" in out
    assert android.patch_apktool_yml(out, "x").count("renameManifestPackage") == 1


def test_brand_strings_changes_text_only():
    s = '<string name="app_name">Tor Browser</string><string name="tor_browser_x">Tor Browser routes</string>'
    out = android.brand_strings(s)
    assert '<string name="app_name">Umbra</string>' in out
    assert 'name="tor_browser_x"' in out and "Umbra routes" in out


def test_search_assets_onionsearch_default_and_all_desktop_providers():
    out = android.search_assets({"ddg": '<Image width="16" height="16">data:image/png;base64,AAAA</Image>'})
    lst = json.loads(out["search/list.json"])
    assert lst["default"]["searchDefault"] == "OnionSearch"
    assert lst["default"]["visibleDefaultEngines"][0] == "onionsearch"
    cfg = json.load(open(os.path.join(ROOT, "overlay", "search", "umbra-search-engines.json")))
    idents = [e["identifier"] for e in cfg if e.get("recordType") == "engine"]
    assert set(lst["default"]["visibleDefaultEngines"]) == set(idents)
    for ident in idents:
        x = out[f"searchplugins/{ident}.xml"].decode()
        xml.dom.minidom.parseString(x)
        assert "{searchTerms}" in x
    assert "data:image/png;base64,AAAA" in out["searchplugins/ddg.xml"].decode()
    os_xml = out["searchplugins/onionsearch.xml"].decode()
    assert 'template="https://onionsearch.io/search"' in os_xml
    assert "x-suggestions" not in os_xml  # no suggestion endpoint -> nothing sent while typing


def test_names_in_list_match_shortnames():
    out = android.search_assets({})
    lst = json.loads(out["search/list.json"])
    for ident, name in zip(lst["default"]["visibleDefaultEngines"], lst["default"]["searchOrder"]):
        short = re.search(r"<ShortName>(.*)</ShortName>", out[f"searchplugins/{ident}.xml"].decode()).group(1)
        assert short.replace("&amp;", "&") == name


def test_android_artifacts_and_tools_pinned():
    lock = json.load(open(os.path.join(ROOT, "upstream", "tor-browser.lock.json")))
    for p in android.ANDROID_PLATFORMS:
        assert p in lock["artifacts"] and lock["artifacts"][p]["file"].endswith(".apk")
    t = lock["android_tools"]["apktool"]
    assert t["url"].startswith("https://") and re.fullmatch(r"[0-9a-f]{64}", t["sha256"])


def test_icons_render(tmp_path):
    for d in ("mipmap-mdpi", "mipmap-xxxhdpi", "drawable"):
        (tmp_path / d).mkdir()
    for n in ("ic_launcher.webp", "ic_launcher_foreground.webp", "ic_launcher_monochrome.webp"):
        (tmp_path / "mipmap-mdpi" / n).write_bytes(b"x")
        (tmp_path / "mipmap-xxxhdpi" / n).write_bytes(b"x")
    (tmp_path / "drawable" / "ic_launcher_background.xml").write_text("x")
    changed = android.write_icons(str(tmp_path))
    from PIL import Image
    assert Image.open(tmp_path / "mipmap-xxxhdpi" / "ic_launcher_foreground.webp").size == (432, 432)
    assert Image.open(tmp_path / "mipmap-mdpi" / "ic_launcher.webp").size == (48, 48)
    assert "0b0d12" in (tmp_path / "drawable" / "ic_launcher_background.xml").read_text()
    assert len(changed) == 7
