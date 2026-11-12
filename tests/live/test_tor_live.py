"""Live Tor tests. Need real access to the Tor network.

Enabled with UMBRA_LIVE_TOR=1 (CI's `live-tor` job). Skipped elsewhere, because
many sandboxes and networks block Tor relays.
"""
import os
import time

import pytest
from selenium.webdriver.common.keys import Keys

from tests.browser_driver import chrome_eval, start, stop

pytestmark = pytest.mark.skipif(os.environ.get("UMBRA_LIVE_TOR") != "1", reason="set UMBRA_LIVE_TOR=1 to run")

TC = "const {TorConnect} = ChromeUtils.importESModule('moz-src:///toolkit/modules/TorConnect.sys.mjs');"


@pytest.fixture(scope="module")
def tor_drv(umbra_app):
    # Let the browser launch and manage its bundled tor (the real user path).
    d = start(umbra_app, prefs={"torbrowser.settings.quickstart.enabled": True}, tor_provider="")
    deadline = time.time() + 240
    stage = None
    while time.time() < deadline:
        stage = chrome_eval(d, TC + "return TorConnect.stageName;")
        if stage == "Bootstrapped":
            break
        if stage == "Start":
            chrome_eval(d, TC + "TorConnect.beginBootstrapping(); return 1;")
        time.sleep(3)
    if stage != "Bootstrapped":
        stop(d)
        pytest.fail(f"Tor did not bootstrap within 240s (stage={stage})")
    yield d
    stop(d)


def test_exit_is_tor(tor_drv):
    tor_drv.set_page_load_timeout(90)
    tor_drv.get("https://check.torproject.org/")
    # Read the API from the page's own origin (the JSON viewer's rendered text isn't reliable).
    data = tor_drv.execute_async_script("""
        const done = arguments[arguments.length - 1];
        fetch('/api/ip').then(r => r.json()).then(done, e => done({error: String(e)}));""")
    assert data.get("IsTor") is True, data


def test_onion_service_navigation(tor_drv):
    tor_drv.set_page_load_timeout(120)
    tor_drv.get("https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/")
    assert "duckduckgo" in tor_drv.current_url


def test_default_search_reaches_onionsearch(tor_drv):
    tor_drv.set_page_load_timeout(120)
    tor_drv.get("about:tor")
    box = tor_drv.find_element("id", "search-input")
    # A real Enter key: geckodriver does not treat a typed "\n" as Enter.
    box.send_keys("tor project", Keys.ENTER)
    # Navigation commits only once onionsearch.io answers over Tor; allow for slow circuits.
    deadline = time.time() + 90
    while time.time() < deadline and tor_drv.current_url.startswith("about:"):
        time.sleep(2)
    assert tor_drv.current_url.startswith("https://onionsearch.io/search?q=tor"), tor_drv.current_url
