"""Umbra Source: offline SecureDrop directory and isolated-instance launch plan."""
import os
import time

import pytest

from tests.browser_driver import chrome_eval, start, stop

URL = "chrome://browser/content/umbra-source/source.html"
MOD = "ChromeUtils.importESModule('resource:///modules/umbra/UmbraSource.sys.mjs').UmbraSource"


@pytest.fixture(scope="module")
def drv(umbra_app):
    d = start(umbra_app)
    yield d
    stop(d)


def test_tools_menu_entry(drv):
    assert chrome_eval(drv, "return !!Services.wm.getMostRecentWindow('navigator:browser')"
                            ".document.getElementById('umbra-source-menuitem');") is True


def test_page_lists_directory_and_filters(drv):
    drv.get(URL)
    time.sleep(1.5)
    body = drv.find_element("tag name", "body").text
    for s in ("Umbra Source", "Tails", "Safest", "SecureDrop directory", "Freedom of the Press Foundation",
              "The Guardian", "ProPublica"):
        assert s in body, s
    total = drv.execute_script("return document.querySelectorAll('.org').length")
    assert total >= 10
    f = drv.find_element("id", "filter")
    f.send_keys("Norway")
    time.sleep(0.3)
    n = drv.execute_script("return document.querySelectorAll('.org').length")
    assert 0 < n < total


def test_csp_forbids_network(drv):
    drv.get(URL)
    csp = drv.execute_script("return document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
    assert "default-src 'none'" in csp and "connect-src chrome:" in csp
    assert "http" not in csp


def test_only_onion_targets_allowed(drv):
    ok = "http://" + "a" * 56 + ".onion/"
    res = chrome_eval(drv, f"""
        const S = {MOD};
        return [S.isAllowedTarget('{ok}'), S.isAllowedTarget('https://example.com/'),
                S.isAllowedTarget('http://short.onion/'), S.isAllowedTarget('file:///etc/passwd'),
                S.isAllowedTarget('http://{"a"*56}.onion.example.com/')];""")
    assert res == [True, False, False, False, False]


def test_launch_plan_is_isolated(drv):
    ok = "http://" + "b" * 56 + ".onion/"
    plan = chrome_eval(drv, f"return {MOD}.launchPlan('{ok}');")
    assert plan["env"] == {"TOR_PROVIDER": "none"}
    assert "--new-instance" in plan["args"] and "--profile" in plan["args"]
    prof = plan["args"][plan["args"].index("--profile") + 1]
    assert prof.endswith("profile.umbra-source")
    main = chrome_eval(drv, "return Services.dirsvc.get('ProfD', Ci.nsIFile).path;")
    assert prof != main
    err = chrome_eval(drv, f"try {{ {MOD}.launchPlan('https://example.com/'); return 'no error'; }}"
                           " catch (e) { return e.message; }")
    assert "only opens onion" in err


def test_source_profile_prefs(drv):
    text = chrome_eval(drv, f"""
        const d = {MOD}.prepareProfile(); const f = d.clone(); f.append('user.js');
        const s = await IOUtils.readUTF8(f.path); await IOUtils.remove(d.path, {{recursive: true}});
        return s;""")
    for line in ('user_pref("network.proxy.type", 1);', 'user_pref("network.proxy.socks_remote_dns", true);',
                 'user_pref("network.proxy.failover_direct", false);',
                 'user_pref("browser.security_level.security_slider", 1);',
                 'user_pref("browser.privatebrowsing.autoStart", true);',
                 'user_pref("umbra.update.notify", false);', 'user_pref("umbra.source.mode", true);'):
        assert line in text, line


def _cmdline(pid):
    if os.path.isdir("/proc/self"):
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\0", b" ").decode()
    import subprocess
    return subprocess.run(["powershell", "-NoProfile", "-Command",
                           f"(Get-CimInstance Win32_Process -Filter 'ProcessId={pid}').CommandLine"],
                          capture_output=True, text=True).stdout


def _kill(pid):
    import subprocess
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
    else:
        subprocess.run(["kill", str(pid)])


def test_launch_starts_separate_instance(drv):
    pid, prof = chrome_eval(drv, f"""
        const S = {MOD}; const p = S.launch('http://' + 'c'.repeat(56) + '.onion/');
        return [p.pid, S.sourceProfileDir().path];""")
    try:
        time.sleep(6)
        args = _cmdline(pid)
        assert "--new-instance" in args and prof in args
        prefs = open(os.path.join(prof, "prefs.js")).read()
        assert 'user_pref("browser.security_level.security_slider", 1);' in prefs
    finally:
        _kill(pid)
        time.sleep(2)
        import shutil
        shutil.rmtree(prof, ignore_errors=True)
