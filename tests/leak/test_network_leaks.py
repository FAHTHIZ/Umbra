"""Network leak tests: every byte must go through the (Tor) SOCKS proxy.

Runs fully offline: a canary SOCKS server replaces Tor. Linux only (/proc).
"""
import sys
import time

import pytest

from tests.browser_driver import start, stop
from tests.leak.sockmon import SockMon
from tests.leak.socks_canary import Canary

pytestmark = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="/proc socket monitor is Linux-only")

HOSTS = ["http://page-a.example/", "http://page-b.example/sub", "http://umbratestaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.onion/"]


def _run(app, canary_port, urls, settle=2.0):
    mon = SockMon(app).start()
    d = start(app, prefs={"network.proxy.socks_port": canary_port, "network.proxy.socks": "127.0.0.1",
                          "network.proxy.type": 1,
                          # canary speaks plain HTTP only; HTTPS-Only would upgrade and fail closed
                          "dom.security.https_only_mode": False, "dom.security.https_only_mode_pbm": False})
    try:
        d.set_page_load_timeout(15)
        for u in urls:
            try:
                d.get(u)
            except Exception:
                pass
        time.sleep(settle)
    finally:
        stop(d)
        mon.stop()
    return mon


def test_all_traffic_goes_through_socks_with_remote_dns(umbra_app):
    canary = Canary()
    try:
        mon = _run(umbra_app, canary.port, HOSTS)
    finally:
        canary.stop()
    assert mon.pids, "socket monitor never saw the browser"
    assert not mon.leaks(), f"DIRECT CONNECTION LEAK (bypassed proxy): {mon.leaks()}"
    hosts = {e["host"] for e in canary.log}
    assert "page-a.example" in hosts and "page-b.example" in hosts
    ip_requests = [e for e in canary.log if e["atyp"] in (1, 4)]
    assert not ip_requests, f"DNS LEAK: browser resolved names locally and sent IPs: {ip_requests}"
    for leak in ("stun-leak.example", "prefetch-leak.example"):
        assert leak not in hosts, f"{leak} contacted"
    udp53 = [s for s in mon.seen if s[0].startswith("udp") and s[2] == 53]
    assert not udp53, f"local DNS queries observed: {udp53}"


def test_fail_closed_when_tor_proxy_is_down(umbra_app):
    """No direct-connection fallback: with the proxy unreachable, nothing leaves."""
    import socket
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    dead_port = s.getsockname()[1]
    s.close()
    mon = _run(umbra_app, dead_port, HOSTS[:2], settle=3.0)
    assert mon.pids
    assert not mon.leaks(), f"DIRECT FALLBACK LEAK with proxy down: {mon.leaks()}"


def test_circuit_isolation_per_first_party(umbra_app):
    """Different first-party sites must use different SOCKS credentials,
    which makes Tor build separate circuits for them."""
    canary = Canary()
    try:
        _run(umbra_app, canary.port, HOSTS[:2], settle=1.0)
    finally:
        canary.stop()
    users = {}
    for e in canary.log:
        if e["host"] in ("page-a.example", "page-b.example"):
            users.setdefault(e["host"], set()).add(e["user"])
    assert set(users) == {"page-a.example", "page-b.example"}, canary.log
    assert all(u and None not in u for u in users.values()), "no isolation credentials sent"
    assert users["page-a.example"].isdisjoint(users["page-b.example"]), f"sites share a circuit: {users}"


def test_update_check_goes_through_tor(umbra_app):
    """The release-notice request must use the SOCKS proxy with remote DNS."""
    from tests.browser_driver import chrome_eval
    canary = Canary()
    mon = SockMon(umbra_app).start()
    d = start(umbra_app, prefs={"network.proxy.socks_port": canary.port, "network.proxy.socks": "127.0.0.1",
                                "network.proxy.type": 1,
                                "umbra.update.url": "http://updates-canary.example/releases/latest"})
    try:
        chrome_eval(d, "const {UmbraUpdateNotice:U}=ChromeUtils.importESModule("
                       "'resource:///modules/umbra/UmbraUpdateNotice.sys.mjs'); await U.checkNow();")
        time.sleep(1)
    finally:
        stop(d)
        mon.stop()
        canary.stop()
    assert not mon.leaks(), f"update check bypassed proxy: {mon.leaks()}"
    hits = [e for e in canary.log if e["host"] == "updates-canary.example"]
    assert hits, "update check never reached the SOCKS proxy"
    assert all(e["atyp"] == 3 for e in hits), "update check resolved DNS locally"
