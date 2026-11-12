"""Live Tor test for Umbra Investigate (UMBRA_LIVE_TOR=1). Separate module so the main live
browser (and its tor) is shut down first: two bundled tors cannot share the SOCKS port."""
import os
import time

import pytest

from tests.browser_driver import chrome_eval, start, stop

pytestmark = pytest.mark.skipif(os.environ.get("UMBRA_LIVE_TOR") != "1", reason="set UMBRA_LIVE_TOR=1 to run")

TC = "const {TorConnect} = ChromeUtils.importESModule('moz-src:///toolkit/modules/TorConnect.sys.mjs');"

INV = "ChromeUtils.importESModule('resource:///modules/umbra/UmbraInvestigate.sys.mjs').UmbraInvestigate"


def test_investigate_mode_over_real_tor(umbra_app):
    """Onion-only guard with a real Tor bootstrap: the bootstrap itself works (it runs in tor,
    not Gecko), an onion service loads, and a clearnet page is blocked with an explanation."""
    d = start(umbra_app, prefs={"torbrowser.settings.quickstart.enabled": True, "umbra.investigate.mode": True,
                                "dom.security.https_only_mode": False, "dom.security.https_only_mode_pbm": False},
              tor_provider="")
    try:
        deadline = time.time() + 240
        stage = None
        while time.time() < deadline:
            stage = chrome_eval(d, TC + "return TorConnect.stageName;")
            if stage == "Bootstrapped":
                break
            if stage == "Start":
                chrome_eval(d, TC + "TorConnect.beginBootstrapping(); return 1;")
            time.sleep(3)
        assert stage == "Bootstrapped", f"Tor did not bootstrap in Investigate mode (stage={stage})"
        assert chrome_eval(d, f"return {INV}.guardStatus().installed;") is True
        d.set_page_load_timeout(120)
        d.get("https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/")
        assert "duckduckgogg42" in d.current_url
        try:
            d.get("https://check.torproject.org/")
        except Exception:
            pass
        time.sleep(2)
        url = chrome_eval(d, "return Services.wm.getMostRecentWindow('navigator:browser').gBrowser.currentURI.spec;")
        assert url.startswith("chrome://browser/content/umbra-investigate/blocked.html"), url
        log = chrome_eval(d, f"return {INV}.getLog();")
        assert any(r["host"] == "check.torproject.org" and r.get("blocked") for r in log)
        assert not any(r["host"] == "check.torproject.org" and not r.get("blocked") for r in log)
    finally:
        stop(d)
