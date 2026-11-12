"""Browser-level smoke test for the native Access Engine's local page inspection."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

from tests.browser_driver import chrome_eval, start, stop


class _FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"""<!doctype html>
        <html><head><title>Umbra local inspection fixture</title></head>
        <body>
          <div class="paywall">Subscription required</div>
          <div id="onetrust-banner-sdk" role="dialog">Cookie preferences</div>
          <form id="registration">
            <input type="email" autocomplete="email">
            <input type="password" autocomplete="new-password">
            <button type="submit">Create account</button>
          </form>
          <h1>Checkout</h1>
          <button>Pay now</button>
        </body></html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def _start_fixture_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _FixtureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, f"http://127.0.0.1:{server.server_port}/fixture"


def test_local_page_inspection_runs_inside_browser(umbra_app):
    server, thread, url = _start_fixture_server()
    driver = None
    try:
        # Test-only: reach the loopback fixture directly. Tor Browser hijacks
        # localhost into the SOCKS proxy, which isn't running in this test.
        driver = start(umbra_app, tor_provider="none", prefs={
            "network.proxy.type": 0,
            "network.proxy.allow_hijacking_localhost": False,
            "dom.security.https_only_mode": False,
        })
        report = chrome_eval(driver, """
          const { UmbraAccessEngine } = ChromeUtils.importESModule("resource:///modules/umbra/AccessEngine.sys.mjs");
          return await new Promise(resolve => {
            let finished = false;
            const finish = value => {
              if (finished) return;
              finished = true;
              clearTimeout(timer);
              try { Services.obs.removeObserver(observer, "umbra-access-state-changed"); } catch (_) {}
              resolve(value);
            };
            const observer = {
              observe() {
                const state = UmbraAccessEngine.getState();
                if (state.latestPage.loginDetected || state.latestPage.paywallDetected) {
                  finish(state.latestPage);
                }
              }
            };
            const timer = setTimeout(() => finish(null), 10000);
            Services.obs.addObserver(observer, "umbra-access-state-changed");
            gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
            });
          });
        """, url)
        assert report is not None, "Access Engine did not publish a local page report"
        assert report["loginDetected"] is True
        assert report["registrationDetected"] is True
        assert report["paywallDetected"] is True
        assert report["checkoutDetected"] is True
        assert report["cookieDialogDetected"] is True
        assert "url" not in report
        assert "hostname" not in report
        assert isinstance(report["isOnion"], bool)
    finally:
        if driver is not None:
            stop(driver)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_access_dashboard_is_packaged_and_toolbar_is_registered(umbra_app):
    driver = start(umbra_app, tor_provider="none")
    try:
        result = chrome_eval(driver, """
          const { CustomizableUI } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs");
          const widgetRegistered = CustomizableUI.getWidget("umbra-access-toolbar-button")?.provider === CustomizableUI.PROVIDER_API;
          const tab = gBrowser.addTab("chrome://browser/content/umbra-access/dashboard.html", {
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
          });
          gBrowser.selectedTab = tab;
          await new Promise(resolve => setTimeout(resolve, 1200));
          const doc = tab.linkedBrowser.contentDocument;
          const csp = doc.querySelector('meta[http-equiv="Content-Security-Policy"]');
          return {
            widgetRegistered,
            title: doc.title,
            csp: csp ? csp.content : ""
          };
        """)
        assert result["widgetRegistered"] is True
        assert result["title"] == "Umbra Access Engine"
        assert "connect-src 'none'" in result["csp"]
    finally:
        stop(driver)
