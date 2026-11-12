"""Umbra Privacy dashboard renders from live browser state, locally."""
import time

import pytest

from tests.browser_driver import chrome_eval, start, stop

URL = "chrome://browser/content/umbra-privacy/privacy.html"


@pytest.fixture(scope="module")
def drv(umbra_app):
    d = start(umbra_app)
    yield d
    stop(d)


def test_tools_menu_entry(drv):
    assert chrome_eval(drv, "return !!Services.wm.getMostRecentWindow('navigator:browser')"
                            ".document.getElementById('umbra-privacy-menuitem');") is True


def test_dashboard_reflects_real_state(drv):
    drv.get(URL)
    time.sleep(1.5)
    body = drv.find_element("tag name", "body").text
    for s in ("Umbra Privacy", "All traffic through Tor", "SOCKS 127.0.0.1:9150", "Fingerprinting protection",
              "OnionSearch", "Forgotten on close", "based on Tor Browser 16."):
        assert s in body, s
    # Tor isn't launched in tests (TOR_PROVIDER=none): must not claim "Fully protected".
    assert "Fully protected" not in body
    assert drv.execute_script("return document.querySelector('header img').naturalWidth") > 0


def test_dashboard_updates_live_and_flags_weakening(drv):
    drv.get(URL)
    time.sleep(1)
    chrome_eval(drv, "Services.prefs.setBoolPref('media.peerconnection.enabled', true);")
    try:
        time.sleep(0.8)
        assert "weakened" in drv.find_element("id", "overall").text
    finally:
        chrome_eval(drv, "Services.prefs.clearUserPref('media.peerconnection.enabled');")


def test_dashboard_csp_blocks_network(drv):
    drv.get(URL)
    csp = drv.execute_script("return document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
    assert "connect-src 'none'" in csp and "default-src 'none'" in csp
