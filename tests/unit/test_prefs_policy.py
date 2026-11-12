"""Umbra must not alter prefs that change what websites can observe."""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# Any pref under these prefixes affects fingerprinting, network routing,
# isolation or security. Changing them must go through a security review
# and be added to ALLOWED with a written justification.
DENY_PREFIXES = (
    "privacy.", "network.", "media.", "webgl.", "dom.", "javascript.", "security.",
    "gfx.", "layout.", "font.", "intl.", "general.", "browser.display.", "permissions.",
    "geo.", "torbrowser.", "extensions.torlauncher.", "browser.security_level.",
    "extensions.torbutton.", "browser.privatebrowsing.", "webgpu.", "image.", "canvas.",
    "browser.cache.", "dom.storage", "signon.", "xpinstall.", "extensions.webextensions.",
)
ALLOWED = {}


def umbra_prefs():
    src = open(os.path.join(ROOT, "overlay/prefs/umbra-prefs.js")).read()
    return re.findall(r'^\s*pref\("([^"]+)"', src, re.M)


def test_prefs_layer_does_not_touch_fingerprinting_or_network_prefs():
    bad = [p for p in umbra_prefs() if p.startswith(DENY_PREFIXES) and p not in ALLOWED]
    assert not bad, f"security-sensitive prefs changed without review: {bad}"


def test_prefs_parse():
    assert len(umbra_prefs()) >= 5


def test_policies_disable_updates_and_telemetry():
    p = json.load(open(os.path.join(ROOT, "overlay/policies/policies.json")))["policies"]
    assert p["DisableAppUpdate"] is True
    assert p["DisableTelemetry"] is True
    assert p["DisableFirefoxStudies"] is True
