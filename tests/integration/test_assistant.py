"""Umbra Assistant: local, model-free page analysis via a content actor; ML stays disabled."""
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from tests.browser_driver import chrome_eval, start, stop

MOD = "ChromeUtils.importESModule('resource:///modules/umbra/UmbraAssistant.sys.mjs').UmbraAssistant"
ONION = "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwx.onion"
PAGE = f"""<!doctype html><html lang="en"><head><title>Relay diversity report</title></head><body>
<nav>Home About Contact</nav><main><h1>Relay diversity report</h1>
<p>Tor relays are run by volunteers in many countries and the network depends on their diversity.</p>
<p>Network diversity makes it harder for any single operator to observe both ends of a circuit.</p>
<h2>Onion services</h2>
<p>Onion services keep connections inside the Tor network, and their addresses come from public keys.</p>
<p>The research team measured relay diversity across the network for twelve months in a row.</p>
<p>The office kitchen was repainted in a cheerful yellow colour during the spring of that year.</p>
<p>Readers can reach the project at {ONION} or follow <a href="https://example.org/more">the follow-up</a>.</p>
</main></body></html>""".encode()


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *a):
        pass


@pytest.fixture(scope="module")
def env(umbra_app):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    # Test-only: reach the loopback fixture directly.
    d = start(umbra_app, prefs={"network.proxy.type": 0, "network.proxy.allow_hijacking_localhost": False,
                                "dom.security.https_only_mode": False})
    yield d, f"http://127.0.0.1:{srv.server_port}/"
    stop(d)
    srv.shutdown()


def test_menu_and_ml_stays_disabled(env):
    drv, _ = env
    r = chrome_eval(drv, """const d = Services.wm.getMostRecentWindow('navigator:browser').document;
        return [!!d.getElementById('umbra-assistant-menuitem'), Services.prefs.getBoolPref('browser.ml.enable'),
                Services.prefs.getBoolPref('browser.translations.enable')];""")
    assert r == [True, False, False]


def test_summarise_page(env):
    drv, url = env
    drv.get(url)
    time.sleep(1)
    ex = chrome_eval(drv, f"const w = Services.wm.getMostRecentWindow('navigator:browser'); return await {MOD}.analyzeTab(w);")
    assert "error" not in ex, ex
    assert ex["title"] == "Relay diversity report"
    assert "Home About Contact" not in ex["text"], "prefers <main> over page chrome"
    chrome_eval(drv, "const w = Services.wm.getMostRecentWindow('navigator:browser');"
                     "w.gBrowser.selectedTab = w.gBrowser.addTrustedTab('chrome://browser/content/umbra-assistant/assistant.html');")
    time.sleep(1.5)
    handles = drv.window_handles
    drv.switch_to.window(handles[-1])
    body = drv.find_element("tag name", "body").text
    assert "Relay diversity report" in body
    assert ONION in body
    assert "kitchen" not in drv.find_element("id", "summary").text
    assert "example.org/more" in body
    assert "no network" in body.lower()


def test_non_web_pages_explain(env):
    drv, _ = env
    drv.switch_to.window(drv.window_handles[0])
    drv.get("about:blank")
    time.sleep(0.5)
    ex = chrome_eval(drv, f"const w = Services.wm.getMostRecentWindow('navigator:browser'); return await {MOD}.analyzeTab(w);")
    assert "error" in ex
