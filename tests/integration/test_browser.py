"""Launch the built Umbra headless and verify real browser behaviour."""
import pytest

from tests.browser_driver import chrome_eval, start, stop

SEARCH = "const S=ChromeUtils.importESModule('moz-src:///toolkit/components/search/SearchService.sys.mjs').SearchService; await S.init();"


@pytest.fixture(scope="module")
def drv(umbra_app):
    d = start(umbra_app)
    yield d
    stop(d)


def test_default_search_is_onionsearch(drv):
    r = chrome_eval(drv, SEARCH + "const e=await S.getDefault(); const p=await S.getDefaultPrivate();"
                    "return {n:e.name, p:p.name, u:e.getSubmission('hidden wiki').uri.spec};")
    assert r["n"] == "OnionSearch" and r["p"] == "OnionSearch"
    assert r["u"] == "https://onionsearch.io/search?q=hidden+wiki"


def test_all_providers_registered(drv):
    names = chrome_eval(drv, SEARCH + "return (await S.getVisibleEngines()).map(e=>e.name);")
    for n in ["OnionSearch", "DuckDuckGo", "DuckDuckGo (.onion)", "Brave Search", "Brave Search (.onion)",
              "Startpage", "Ecosia", "Google", "Mojeek"]:
        assert n in names


def test_provider_switch_and_custom_engine(drv):
    r = chrome_eval(drv, SEARCH + """
      const ddg = S.getEngineByName('DuckDuckGo');
      await S.setDefault(ddg, S.CHANGE_REASON?.USER ?? "user");
      const after = (await S.getDefault()).name;
      await S.addUserEngine({name:'My SearX', url:'https://searx.example/search?q={searchTerms}', alias:'sx'});
      const u = S.getEngineByName('My SearX').getSubmission('abc').uri.spec;
      await S.setDefault(S.getEngineByName('OnionSearch'), S.CHANGE_REASON?.USER ?? "user");
      return {after, u, back:(await S.getDefault()).name};""")
    assert r == {"after": "DuckDuckGo", "u": "https://searx.example/search?q=abc", "back": "OnionSearch"}, r


def test_branding_and_policies(drv):
    r = chrome_eval(drv, """
      const b = Services.strings.createBundle('chrome://branding/locale/brand.properties');
      Services.prefs.setBoolPref('app.update.disabledForTesting', false);
      const upd = Cc['@mozilla.org/updates/update-service;1'].getService(Ci.nsIApplicationUpdateService);
      const disabled = upd.disabled;
      Services.prefs.setBoolPref('umbra.update.disabled', false);
      const reenabled = !upd.disabled;
      Services.prefs.setBoolPref('umbra.update.disabled', true);
      return {disabled, reenabled, brand: b.GetStringFromName('brandShortName'), policies: Services.policies.status,
              update: Cc['@mozilla.org/updates/update-service;1'].getService(Ci.nsIApplicationUpdateService).disabled,
              ver: Services.prefs.getStringPref('umbra.version')};""")
    assert r["brand"] == "Umbra"
    assert r["policies"] != 1  # not ACTIVE: policies would alter fingerprint
    assert r["update"] is True
    assert r["disabled"] is True and r["reenabled"] is True  # disabled by Umbra's pref, not by automation
    assert r["ver"]


def test_home_page_defaults(drv):
    drv.get("about:tor")
    sel = drv.execute_script("return [document.getElementById('provider').value, document.getElementById('search-form').action, document.querySelectorAll('.onion').length, document.title]")
    assert sel[0] == "onionsearch"
    assert sel[1] == "https://onionsearch.io/search"
    assert sel[2] >= 10
    assert sel[3] == "Umbra"


def test_webrtc_unavailable_to_content(drv):
    drv.get("about:blank")
    assert drv.execute_script("return typeof RTCPeerConnection") == "undefined"


def test_tabs_and_navigation(drv):
    drv.get("about:tor")
    drv.switch_to.new_window("tab")
    drv.get("about:blank")
    assert len(drv.window_handles) >= 2
    drv.back()
    drv.forward()
    drv.refresh()
    drv.close()
    drv.switch_to.window(drv.window_handles[0])
