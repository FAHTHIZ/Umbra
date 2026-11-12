"""Investigate (onion-only) leak tests.

A canary SOCKS server stands in for Tor and serves the onion pages; /proc is polled for any
socket the browser opens. Everything must stay onion-only: no clearnet host may reach the
proxy, no direct sockets, no local DNS, names (not IPs) in every SOCKS request, and the
browser must fail closed when the proxy is down. Linux only.
"""
import socket
import sys
import time

import pytest

from tests.browser_driver import chrome_eval, start, stop
from tests.leak.sockmon import SockMon
from tests.leak.socks_canary import Canary, http_response

pytestmark = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="/proc socket monitor is Linux-only")

ONION = "umbratest" + "a" * 47 + ".onion"
assert len(ONION) == 62
OTHER_ONION = "umbraother" + "b" * 46 + ".onion"
MOD = "ChromeUtils.importESModule('resource:///modules/umbra/UmbraInvestigate.sys.mjs').UmbraInvestigate"

PAGE = (f'<!doctype html><title>t</title>'
        f'<link rel="preconnect" href="https://preconnect-leak.example/">'
        f'<link rel="dns-prefetch" href="//dnsprefetch-leak.example/">'
        f'<link rel="stylesheet" href="https://css-leak.example/a.css">'
        f'<img src="http://img-leak.example/p.png"><img src="http://{OTHER_ONION}/ok.png">'
        f'<iframe src="https://frame-leak.example/"></iframe>'
        f'<script>try{{new WebSocket("ws://ws-leak.example/")}}catch(e){{}}'
        f'fetch("https://fetch-leak.example/x").catch(()=>{{}});'
        f'navigator.sendBeacon && navigator.sendBeacon("https://beacon-leak.example/b","x");'
        f'try{{new RTCPeerConnection({{iceServers:[{{urls:"stun:stun-leak.example:3478"}}]}}).createDataChannel("x")}}catch(e){{}}'
        f'</script>')


def responder(host, port, req):
    path = req.split(b" ")[1].decode()
    if path.startswith("/redir"):
        return http_response("", "302 Found", [("Location", "http://redirect-leak.example/landing")])
    if path.startswith("/meta"):
        return http_response('<meta http-equiv="refresh" content="0;url=https://meta-leak.example/">')
    if path.startswith("/js"):
        return http_response('<script>location.href="https://js-leak.example/"</script>')
    return http_response(PAGE)


def _run(app, port, urls, settle=2.0, check=None):
    mon = SockMon(app).start()
    d = start(app, prefs={"umbra.investigate.mode": True, "network.proxy.type": 1, "network.proxy.socks": "127.0.0.1",
                          "network.proxy.socks_port": port, "network.proxy.socks_remote_dns": True,
                          "dom.security.https_only_mode": False, "dom.security.https_only_mode_pbm": False})
    out = {}
    try:
        d.set_page_load_timeout(15)
        for u in urls:
            try:
                d.get(u)
            except Exception:
                pass
            time.sleep(1.0)
        time.sleep(settle)
        if check:
            out = check(d)
    finally:
        stop(d)
        mon.stop()
    return mon, out


@pytest.fixture(scope="module")
def run(umbra_app):
    canary = Canary(responder)

    def check(d):
        return {"url": chrome_eval(d, "return Services.wm.getMostRecentWindow('navigator:browser').gBrowser.currentURI.spec;"),
                "log": chrome_eval(d, f"return {MOD}.getLog();"),
                "status": chrome_eval(d, f"return {MOD}.guardStatus();")}

    try:
        mon, out = _run(umbra_app, canary.port, [
            f"http://{ONION}/page", "https://clearnet-leak.example/", f"http://{ONION}/redir",
            f"http://{ONION}/meta", f"http://{ONION}/js", f"http://{ONION}/page"], check=check)
    finally:
        canary.stop()
    return mon, canary, out


def test_only_onion_hosts_reach_the_proxy(run):
    mon, canary, _ = run
    hosts = {e["host"] for e in canary.log}
    assert ONION in hosts, "the onion page itself must load"
    clear = {h for h in hosts if not h.endswith(".onion")}
    assert not clear, f"CLEARNET LEAK in onion-only mode: {clear}"


def test_no_direct_sockets_and_no_local_dns(run):
    mon, _, _ = run
    assert mon.pids, "socket monitor never saw the browser"
    assert not mon.leaks(), f"DIRECT CONNECTION LEAK: {mon.leaks()}"
    udp53 = [s for s in mon.seen if s[0].startswith("udp") and s[2] == 53]
    assert not udp53, f"local DNS queries observed: {udp53}"


def test_names_not_ips_sent_to_proxy(run):
    _, canary, _ = run
    assert canary.log and all(e["atyp"] == 3 for e in canary.log), [e for e in canary.log if e["atyp"] != 3]


def test_subresources_and_redirects_are_logged_as_blocked(run):
    _, _, out = run
    blocked = {r["host"] for r in out["log"] if r.get("blocked")}
    for h in ("clearnet-leak.example", "redirect-leak.example", "img-leak.example", "css-leak.example",
              "frame-leak.example", "meta-leak.example", "js-leak.example"):
        assert h in blocked, (h, sorted(blocked))
    assert out["status"]["stats"]["blocked"] >= 7


def test_redirect_explained_with_origin(run):
    _, _, out = run
    redir = [r for r in out["log"] if r["host"] == "redirect-leak.example"]
    assert redir and redir[0]["topLevel"] and redir[0]["redirectedFrom"] == f"http://{ONION}/redir"


def test_fail_closed_when_proxy_down(umbra_app):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    dead = s.getsockname()[1]
    s.close()
    mon, _ = _run(umbra_app, dead, [f"http://{ONION}/", "https://clearnet-leak.example/"], settle=2.0)
    assert mon.pids
    assert not mon.leaks(), f"DIRECT FALLBACK LEAK with proxy down: {mon.leaks()}"
