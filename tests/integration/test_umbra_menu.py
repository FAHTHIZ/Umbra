"""'Umbra' toolbar button: placed once in the nav bar, lists every module, entries open pages."""
import time

import pytest

from tests.browser_driver import chrome_eval, start, stop

CUI = "const {CustomizableUI:C}=ChromeUtils.importESModule('moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs');"
WIN = "const w = Services.wm.getMostRecentWindow('navigator:browser'); const d = w.document;"


@pytest.fixture(scope="module")
def drv(umbra_app):
    d = start(umbra_app)
    yield d
    stop(d)


def test_button_placed_in_navbar(drv):
    r = chrome_eval(drv, CUI + WIN + """
        return {provider: C.getWidget('umbra-menu-button').provider, area: C.getPlacementOfWidget('umbra-menu-button')?.area,
                inDom: !!d.getElementById('umbra-menu-button'),
                placed: Services.prefs.getBoolPref('umbra.menu.toolbarPlaced', false)};""")
    assert r == {"provider": "api", "area": "nav-bar", "inDom": True, "placed": True}, r


def test_lists_all_modules(drv):
    ids = chrome_eval(drv, WIN + "return [...d.querySelectorAll('#umbra-menu-button-popup menuitem')].map(m => m.id);")
    for m in ("privacy", "desk", "assistant", "vault", "source", "access", "newidentity"):
        assert f"umbra-menu-{m}" in ids


@pytest.mark.parametrize("item,url", [
    ("privacy", "umbra-privacy/privacy.html"), ("desk", "umbra-desk/desk.html"),
    ("vault", "umbra-vault/vault.html"), ("source", "umbra-source/source.html"),
    ("access", "umbra-access/dashboard.html"),
])
def test_entries_open_pages(drv, item, url):
    chrome_eval(drv, WIN + f"d.getElementById('umbra-menu-{item}').doCommand(); return 1;")
    time.sleep(0.8)
    cur = chrome_eval(drv, WIN + "return w.gBrowser.selectedBrowser.currentURI.spec;")
    assert cur.endswith(url), cur


def test_user_removal_respected(drv):
    chrome_eval(drv, CUI + "C.removeWidgetFromArea('umbra-menu-button'); return 1;")
    # Re-running init must not put it back.
    chrome_eval(drv, "ChromeUtils.importESModule('resource:///modules/umbra/UmbraMenu.sys.mjs').UmbraMenu.init(); return 1;")
    assert chrome_eval(drv, CUI + "return C.getPlacementOfWidget('umbra-menu-button');") is None
