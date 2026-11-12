"""The owner's Access Engine is packaged, starts with the browser, and is off by default."""
import json
import time

import pytest

from tests.browser_driver import chrome_eval, start, stop

ENGINE = "const {UmbraAccessEngine:E}=ChromeUtils.importESModule('resource:///modules/umbra/AccessEngine.sys.mjs');"
CUI = "const {CustomizableUI:C}=ChromeUtils.importESModule('moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs');"
ID = "umbra-access-toolbar-button"


@pytest.fixture(scope="module")
def drv(umbra_app):
    d = start(umbra_app)
    yield d
    stop(d)


def test_registered_at_first_window(drv):
    r = json.loads(chrome_eval(drv, """
      const out=[]; for (const c of Services.catMan.enumerateCategory('browser-first-window-ready')) out.push(c.entry+' '+c.value);
      return JSON.stringify(out.filter(x=>x.includes('umbra')));"""))
    assert r == ["resource:///modules/umbra/AccessEngine.sys.mjs UmbraAccessEngine.init"]


def test_off_by_default_and_local_only(drv):
    s = chrome_eval(drv, ENGINE + "return E.getState();")
    assert s["enabled"] is False, "network filtering must be opt-in (fingerprint)"
    assert s["cosmetic"] is False
    assert s["localOnly"] is True
    assert s["ruleCount"] > 0


def test_toolbar_button_placed(drv):
    r = chrome_eval(drv, CUI + f"""
      return {{provider: C.getWidget('{ID}').provider, area: C.getPlacementOfWidget('{ID}')?.area,
               inDom: !!Services.wm.getMostRecentWindow('navigator:browser').document.getElementById('{ID}')}};""")
    assert r == {"provider": "api", "area": "nav-bar", "inDom": True}, r


def test_dashboard_renders(drv):
    drv.get("chrome://browser/content/umbra-access/dashboard.html")
    time.sleep(1)
    body = drv.find_element("tag name", "body").text
    assert "Access Engine" in body and "LOCAL ONLY" in body.upper()


def test_toggle_roundtrip(drv):
    r = chrome_eval(drv, ENGINE + """
      E.setEnabled(true); const on=E.getState().enabled;
      E.setEnabled(false); const off=E.getState().enabled;
      return {on, off};""")
    assert r == {"on": True, "off": False}
