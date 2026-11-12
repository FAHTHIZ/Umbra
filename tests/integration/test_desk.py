"""Umbra Desk: memory-only notes, tab overview, cleared on New Identity, nothing on disk."""
import os
import time

import pytest

from tests.browser_driver import chrome_eval, start, stop

URL = "chrome://browser/content/umbra-desk/desk.html"
MOD = "ChromeUtils.importESModule('resource:///modules/umbra/UmbraDesk.sys.mjs').UmbraDesk"
MARK = "desk-note-marker-7f3a91"


@pytest.fixture(scope="module")
def drv(umbra_app):
    d = start(umbra_app)
    yield d
    stop(d)


def test_tools_menu_entry(drv):
    assert chrome_eval(drv, "return !!Services.wm.getMostRecentWindow('navigator:browser')"
                            ".document.getElementById('umbra-desk-menuitem');") is True


def test_page_and_notes_memory_only(drv):
    drv.get(URL)
    time.sleep(1)
    body = drv.find_element("tag name", "body").text.lower()
    for s in ("umbra desk", "memory only", "close and forget", "new identity", "open tabs"):
        assert s in body, s
    drv.find_element("id", "notes").send_keys(MARK)
    time.sleep(0.3)
    assert chrome_eval(drv, f"return {MOD}.getNotes();") == MARK
    # Survives navigating away and back (same session).
    drv.get("about:blank")
    drv.get(URL)
    time.sleep(0.8)
    assert drv.find_element("id", "notes").get_attribute("value") == MARK
    # Never written to the profile.
    prof = chrome_eval(drv, "return Services.dirsvc.get('ProfD', Ci.nsIFile).path;")
    chrome_eval(drv, "await IOUtils.flush?.(); return 1;")
    for root, _dirs, files in os.walk(prof):
        for f in files:
            p = os.path.join(root, f)
            try:
                assert MARK.encode() not in open(p, "rb").read(), p
            except (PermissionError, FileNotFoundError):
                pass


def test_tabs_listed(drv):
    chrome_eval(drv, "const w = Services.wm.getMostRecentWindow('navigator:browser');"
                     "w.gBrowser.addTrustedTab('about:robots');")
    drv.get(URL)
    time.sleep(0.8)
    n = drv.execute_script("return window.UmbraDeskPage.renderTabs().length")
    assert n >= 1


def test_cleared_on_new_identity(drv):
    chrome_eval(drv, f"{MOD}.setNotes('to be forgotten');")
    chrome_eval(drv, "Services.obs.notifyObservers({}, 'new-identity-requested');")
    assert chrome_eval(drv, f"return {MOD}.getNotes();") == ""


def test_new_identity_command_exists(drv):
    assert chrome_eval(drv, "return !!Services.wm.getMostRecentWindow('navigator:browser')"
                            ".document.getElementById('cmd_newIdentity');") is True
