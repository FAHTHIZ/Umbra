"""Release notice: shows a bar for a newer release, stays quiet otherwise, never downloads."""
import json
import urllib.parse

import pytest

from tests.browser_driver import chrome_eval, start, stop

MOD = "const {UmbraUpdateNotice:U}=ChromeUtils.importESModule('resource:///modules/umbra/UmbraUpdateNotice.sys.mjs');"
BAR = ("return !!Services.wm.getMostRecentWindow('navigator:browser')"
       ".gNotificationBox.getNotificationWithValue('umbra-update-available');")


def data_url(obj):
    return "data:application/json," + urllib.parse.quote(json.dumps(obj))


@pytest.fixture
def drv(umbra_app):
    d = start(umbra_app)
    yield d
    stop(d)


def test_registered_and_enabled_by_default(drv):
    r = chrome_eval(drv, """
      const c=[]; for (const e of Services.catMan.enumerateCategory('browser-first-window-ready')) c.push(e.entry);
      return {cat: c.includes('resource:///modules/umbra/UmbraUpdateNotice.sys.mjs'),
              notify: Services.prefs.getBoolPref('umbra.update.notify'),
              mar: Services.prefs.getBoolPref('umbra.update.disabled')};""")
    assert r == {"cat": True, "notify": True, "mar": True}


def test_newer_release_shows_notification(drv):
    chrome_eval(drv, "Services.prefs.setStringPref('umbra.update.url', arguments[0]);",
                data_url({"tag_name": "v99.0.0", "html_url": "https://evil.example/"}))
    r = chrome_eval(drv, MOD + "const a = await U.checkNow(); return a;")
    assert r == {"version": "99.0.0", "url": "https://github.com/FAHTHIZ/Umbra/releases/tag/v99.0.0"}
    assert chrome_eval(drv, BAR) is True


def test_same_version_is_quiet(drv):
    chrome_eval(drv, "Services.prefs.setStringPref('umbra.update.url', arguments[0]);",
                data_url({"tag_name": "v0.0.1"}))
    assert chrome_eval(drv, MOD + "return await U.checkNow();") is None
    assert chrome_eval(drv, BAR) is False


def test_failure_is_silent(drv):
    chrome_eval(drv, "Services.prefs.setStringPref('umbra.update.url', 'data:application/json,not-json');")
    assert chrome_eval(drv, MOD + "return await U.checkNow();") is None
