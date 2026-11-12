"""Umbra Investigate end to end: launcher (normal window), guard, inspection, evidence capture,
exports and offline verification with the pinned upstream tools (hashdeep, mitmproxy, exiftool).

Runs offline: a canary SOCKS server stands in for Tor and serves the onion pages.
"""
import json
import os
import shutil
import subprocess
import sys
import time

import pytest

from tests.browser_driver import chrome_eval, start, stop
from tests.leak.socks_canary import Canary, http_response

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DASH = "chrome://browser/content/umbra-investigate/investigate.html"
MOD = "ChromeUtils.importESModule('resource:///modules/umbra/UmbraInvestigate.sys.mjs').UmbraInvestigate"
ONION = "umbrainvestigatetest" + "a" * 36 + ".onion"
assert len(ONION) == 62

LOGIN = (f'<!doctype html><html><head><title>Members area</title></head><body><h1>Sign in</h1>'
         f'<form method="post" action="/auth"><label>User <input name="user" value="secret-user"></label>'
         f'<input type="password" name="pass" value="secret-pass"><button>Log in</button></form>'
         f'<div class="g-recaptcha"></div><p>Donate: bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq</p>'
         f'<a href="http://{ONION}/other">other</a><a href="https://clear.example/">clear</a>'
         f'<img src="http://img-leak.example/x.png"></body></html>')


def responder(host, port, req):
    path = req.split(b" ")[1].decode()
    if path.startswith("/redir"):
        return http_response("", "302 Found", [("Location", "http://redirect-leak.example/")])
    if path.startswith("/login"):
        return http_response(LOGIN, headers=[("Set-Cookie", "sid=topsecretcookie; HttpOnly"), ("Server", "canary")])
    if path.startswith("/forbidden"):
        return http_response("<h1>Access denied</h1>", "403 Forbidden")
    return None


@pytest.fixture(scope="module")
def canary():
    c = Canary(responder)
    yield c
    c.stop()


@pytest.fixture(scope="module")
def inv(umbra_app, canary):
    d = start(umbra_app, prefs={
        "umbra.investigate.mode": True, "network.proxy.type": 1, "network.proxy.socks": "127.0.0.1",
        "network.proxy.socks_port": canary.port, "network.proxy.socks_remote_dns": True,
        "dom.security.https_only_mode": False, "dom.security.https_only_mode_pbm": False})
    d.set_page_load_timeout(20)
    yield d
    stop(d)


def _get(d, url):
    try:
        d.get(url)
    except Exception:
        pass
    time.sleep(1.5)


# ------------------------------------------------------------------ normal window: launcher only

def test_launcher_in_normal_window(umbra_app):
    d = start(umbra_app)
    try:
        assert chrome_eval(d, "return !!Services.wm.getMostRecentWindow('navigator:browser').document"
                              ".getElementById('umbra-investigate-menuitem');") is True
        st = chrome_eval(d, f"return {MOD}.guardStatus();")
        assert st["installed"] is False and st["mode"] is False, "guard must not run in the normal browser"
        plan = chrome_eval(d, f"return {MOD}.launchPlan('http://{ONION}/');")
        assert plan["env"] == {"TOR_PROVIDER": "none"} and "--new-instance" in plan["args"]
        prof = plan["args"][plan["args"].index("--profile") + 1]
        assert prof.endswith("profile.umbra-investigate")
        assert prof != chrome_eval(d, "return Services.dirsvc.get('ProfD', Ci.nsIFile).path;")
        err = chrome_eval(d, f"try {{ {MOD}.launchPlan('https://example.com/'); return 'no'; }} catch (e) {{ return e.message; }}")
        assert "only opens onion" in err
        text = chrome_eval(d, f"const dir = await {MOD}.prepareProfile(); const s = await IOUtils.readUTF8(PathUtils.join(dir.path, 'user.js'));"
                              f" await IOUtils.remove(dir.path, {{recursive: true}}); return s;")
        for line in ('"umbra.investigate.mode", true', '"network.proxy.socks_remote_dns", true', '"network.proxy.failover_direct", false',
                     '"network.http.speculative-parallel-limit", 0', '"network.predictor.enabled", false',
                     '"browser.security_level.security_slider", 1', '"browser.privatebrowsing.autoStart", true',
                     '"signon.rememberSignons", false', '"umbra.access.enabled", false'):
            assert f"user_pref({line});" in text, line
        d.get(DASH)
        time.sleep(1)
        assert d.find_element("id", "launcher").is_displayed()
        assert not d.find_element("id", "investigate").is_displayed()
    finally:
        stop(d)


# ------------------------------------------------------------------ investigate instance

def test_guard_installed_and_toolbar(inv):
    st = chrome_eval(inv, f"return {MOD}.guardStatus();")
    assert st["installed"] and st["mode"]
    assert st["layers"] == ["request-observer", "proxy-blackhole"]
    assert st["socks"]["remoteDns"] is True and st["socks"]["type"] == 1
    assert chrome_eval(inv, "return !!Services.wm.getMostRecentWindow('navigator:browser').document.getElementById('umbra-investigate-button');")


def test_default_search_is_onion(inv):
    name = chrome_eval(inv, f"return await {MOD}.setOnionSearchDefault();")
    assert name == "DuckDuckGo (.onion)"


def test_proxy_layer_blackholes_clearnet(inv, canary):
    res = chrome_eval(inv, f"""
      const pps = Cc['@mozilla.org/network/protocol-proxy-service;1'].getService(Ci.nsIProtocolProxyService);
      const res = u => new Promise(ok => {{
        const ch = Services.io.newChannelFromURI(Services.io.newURI(u), null, Services.scriptSecurityManager.getSystemPrincipal(),
          null, 0, Ci.nsIContentPolicy.TYPE_OTHER);
        pps.asyncResolve(ch, 0, {{ onProxyAvailable(r, c, pi) {{ ok(pi ? pi.type + ':' + pi.host + ':' + pi.port : 'direct'); }} }});
      }});
      return [await res('https://example.org/'), await res('http://127.0.0.1:8080/'), await res('http://{ONION}/')];""")
    assert res[0] == "socks:127.0.0.1:9" and res[1] == "socks:127.0.0.1:9"
    assert res[2] == f"socks:127.0.0.1:{canary.port}"


def test_clearnet_navigation_shows_explanation(inv):
    _get(inv, "https://example.com/some/path")
    assert inv.current_url.startswith("chrome://browser/content/umbra-investigate/blocked.html")
    body = inv.find_element("tag name", "body").text
    assert "https://example.com/some/path" in body and "onion-only" in body.lower()


def test_redirect_to_clearnet_blocked(inv, canary):
    _get(inv, f"http://{ONION}/redir")
    assert "blocked.html" in inv.current_url
    body = inv.find_element("tag name", "body").text
    assert "redirect-leak.example" in body and f"Redirected from: http://{ONION}/redir" in body
    assert "redirect-leak.example" not in {e["host"] for e in canary.log}


def test_inspection_is_read_only_and_explains(inv, canary):
    _get(inv, f"http://{ONION}/login")
    before = len(canary.requests)
    rep = chrome_eval(inv, f"const b = Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser;"
                           f" return await {MOD}.inspect(b);")
    kinds = [f["kind"] for f in rep["report"]["findings"]]
    for k in ("login", "captcha", "crypto-address", "clearnet-references"):
        assert k in kinds, (k, kinds)
    blob = json.dumps(rep)
    assert "secret-user" not in blob and "secret-pass" not in blob, "field values must never be read"
    assert "never fills in, submits" in rep["report"]["note"]
    time.sleep(1)
    assert len(canary.requests) == before, "inspection must not cause network requests"
    assert not any(r["head"].startswith("POST") for r in canary.requests), "nothing may be submitted"


def test_access_restriction_from_status(inv):
    _get(inv, f"http://{ONION}/forbidden")
    rep = chrome_eval(inv, f"const b = Services.wm.getMostRecentWindow('navigator:browser').gBrowser.selectedBrowser;"
                           f" return (await {MOD}.inspect(b)).report;")
    assert rep["findings"][0]["kind"] == "access-restricted" and "403" in rep["findings"][0]["title"]


def test_traffic_log_redacts_secrets(inv):
    _get(inv, f"http://{ONION}/login")
    log = chrome_eval(inv, f"return {MOD}.getLog();")
    top = [r for r in log if r["url"] == f"http://{ONION}/login" and r.get("status") == 200]
    assert top, "top-level response recorded"
    hdrs = {h["name"].lower(): h["value"] for h in top[-1]["responseHeaders"]}
    assert hdrs["set-cookie"].startswith("[redacted by Umbra")
    assert "topsecretcookie" not in json.dumps(log)
    blocked = {r["host"] for r in log if r.get("blocked")}
    assert {"img-leak.example", "example.com"} <= blocked


@pytest.fixture(scope="module")
def case(inv):
    """Capture evidence through the dashboard exactly as a user would."""
    _get(inv, f"http://{ONION}/login")
    inv.switch_to.new_window("tab")
    inv.get(DASH)
    time.sleep(1.5)
    r = inv.execute_async_script("""
      const done = arguments[arguments.length - 1];
      (async () => {
        const U = window.UmbraInvestigateUI;
        const c = await U.newCase('Test operation');
        const cap = await U.captureTarget('first capture');
        await U.Store.addNote(U.ui.current, 'investigator note');
        const leads = await U.importLeads('engine,link\\nahmia,http://""" + ONION + """/x\\nclear,https://example.com/\\n');
        const exp = await U.Store.exportCase(U.ui.current);
        const v = await U.Store.verify(U.ui.current);
        return { dir: U.ui.current.dir, id: U.ui.current.id, cap: cap.capture, kinds: cap.artifacts.map(a => a.kind),
                 leads: leads.leads.length, ignored: leads.ignored, verify: v, exp };
      })().then(done, e => done({ __error: String(e) + ' ' + e.stack }));""")
    assert "__error" not in r, r
    return r


def test_capture_produces_hashed_artifacts(case):
    assert case["kinds"] == ["dom", "screenshot", "headers", "inspection", "traffic", "capture"]
    assert case["verify"]["ok"] is True, case["verify"]
    assert case["leads"] == 1 and case["ignored"] == 1
    d = case["dir"]
    man = json.load(open(os.path.join(d, "manifest.json")))
    shot = next(a for a in man["artifacts"] if a["kind"] == "screenshot")
    with open(os.path.join(d, shot["path"]), "rb") as f:
        assert f.read(8) == b"\x89PNG\r\n\x1a\n"
    dom = open(os.path.join(d, next(a for a in man["artifacts"] if a["kind"] == "dom")["path"])).read()
    assert "Members area" in dom
    cap = json.load(open(os.path.join(d, next(a for a in man["artifacts"] if a["kind"] == "capture")["path"])))
    for k in ("umbra", "torBrowser", "gecko"):
        assert cap["versions"][k] and cap["versions"][k] != "unknown", k
    assert cap["started"].endswith("Z") and cap["guard"]["installed"] is True
    assert len(cap["artifacts"]) == 5
    if sys.platform != "win32":
        assert oct(os.stat(d).st_mode & 0o777) == "0o700"
        assert all(oct(os.stat(os.path.join(d, a["path"])).st_mode & 0o777) == "0o600" for a in man["artifacts"])


def test_python_verifier_agrees_and_detects_tampering(case, tmp_path):
    from tools.investigate import caselib
    assert caselib.verify_case(case["dir"])["ok"] is True
    copy = tmp_path / "copy"
    shutil.copytree(case["dir"], copy)
    p = next((copy / "artifacts").glob("*-dom.html"))
    os.chmod(p, 0o600)
    p.write_text(p.read_text() + "<!-- tampered -->")
    res = caselib.verify_case(str(copy))
    assert res["ok"] is False and any(x["problem"] == "hash-mismatch" for x in res["problems"])
    log = (copy / "case-log.jsonl").read_text().splitlines()
    (copy / "case-log.jsonl").write_text("\n".join(log[:1] + log[2:]) + "\n")
    assert caselib.verify_chain(caselib.read_log(str(copy)))["ok"] is False


@pytest.mark.skipif(not shutil.which("hashdeep"), reason="hashdeep not installed")
def test_real_hashdeep_audit_passes(case):
    r = subprocess.run(["hashdeep", "-c", "sha256", "-a", "-k", "../hashdeep.txt", "-l", "-r", "."],
                       cwd=os.path.join(case["dir"], "artifacts"), capture_output=True, text=True)
    assert r.returncode == 0 and "Audit passed" in r.stdout + r.stderr, r.stdout + r.stderr


def test_timesketch_export(case):
    lines = [json.loads(l) for l in open(os.path.join(case["dir"], "timesketch.jsonl"))]
    assert lines and all(l["message"] and l["datetime"].endswith("Z") and l["timestamp_desc"] for l in lines)
    assert any(l["data_type"] == "umbra:investigate:artifact" and l.get("sha256") for l in lines)


def test_mitmproxy_reads_umbra_har(case):
    mio = pytest.importorskip("mitmproxy.io")
    man = json.load(open(os.path.join(case["dir"], "manifest.json")))
    har = os.path.join(case["dir"], next(a for a in man["artifacts"] if a["kind"] == "traffic")["path"])
    flows = list(mio.read_flows_from_paths([har]))
    assert any(f.request.pretty_host == ONION for f in flows)


def test_analyze_case_with_exiftool_and_mitmproxy(case, tmp_path):
    copy = tmp_path / "an"
    shutil.copytree(case["dir"], copy)
    r = subprocess.run([sys.executable, "-m", "tools.investigate.analyze_case", str(copy)], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    man = json.load(open(copy / "manifest.json"))
    kinds = {a["kind"] for a in man["artifacts"]}
    if shutil.which("exiftool"):
        assert "analysis-exiftool" in kinds
        rep = json.load(open(copy / next(a for a in man["artifacts"] if a["kind"] == "analysis-exiftool")["path"]))
        assert any(x.get("File:FileType") == "PNG" for x in rep["results"])
    r = subprocess.run([sys.executable, "-m", "tools.investigate.verify_case", str(copy)], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0 and r.stdout.startswith("VERIFIED"), r.stdout


def test_attach_external_tool_output(case, tmp_path):
    copy = tmp_path / "at"
    shutil.copytree(case["dir"], copy)
    out = tmp_path / "onionscan.json"
    out.write_text(json.dumps({"hiddenService": ONION, "ok": True}))
    r = subprocess.run([sys.executable, "-m", "tools.investigate.attach", str(copy), str(out), "--tool", "onionscan",
                        "--tool-version", "4e54c8001238d09817e2f6a6a689918eb89bb0b5"], cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    from tools.investigate import caselib
    assert caselib.verify_case(str(copy))["ok"] is True
    assert caselib.read_log(str(copy))[-1]["data"]["tool"] == "onionscan"


def test_encrypted_bundle_roundtrip_python(inv, case, tmp_path):
    pytest.importorskip("cryptography")
    r = inv.execute_async_script("""
      const done = arguments[arguments.length - 1];
      (async () => {
        const U = window.UmbraInvestigateUI;
        return await U.Store.encryptCase(U.ui.current, 'correct horse battery staple', { iterations: 100000 });
      })().then(done, e => done({ __error: String(e) }));""")
    assert "__error" not in r, r
    raw = open(r["path"]).read()
    assert "Members area" not in raw and '"format":"umbra-vault"' in raw
    env = dict(os.environ, UMBRA_CASE_PASSPHRASE="correct horse battery staple")
    p = subprocess.run([sys.executable, "-m", "tools.investigate.verify_case", "--bundle", r["path"], "--extract-to", str(tmp_path)],
                       cwd=ROOT, capture_output=True, text=True, env=env)
    assert p.returncode == 0 and p.stdout.startswith("VERIFIED"), p.stdout + p.stderr
    env["UMBRA_CASE_PASSPHRASE"] = "wrong passphrase here"
    p = subprocess.run([sys.executable, "-m", "tools.investigate.verify_case", "--bundle", r["path"], "--extract-to", str(tmp_path / "x")],
                       cwd=ROOT, capture_output=True, text=True, env=env)
    assert p.returncode != 0


def test_dashboard_renders_guard_and_traffic(inv, case):
    inv.get(DASH)
    time.sleep(2.5)
    assert inv.find_element("id", "mode-pill").text == "Onion-only: on"
    assert int(inv.find_element("id", "g-blocked").text) >= 2
    rows = inv.execute_script("return document.querySelectorAll('#traffic tbody tr').length")
    assert rows > 0
    assert inv.execute_script("return document.querySelector('#case-select').value") == case["id"]
