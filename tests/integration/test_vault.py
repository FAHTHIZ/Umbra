"""Umbra Vault: encrypted export/import round trip in the real browser (NSS WebCrypto)."""
import json
import os
import time

import pytest

from tests.browser_driver import chrome_eval, start, stop

URL = "chrome://browser/content/umbra-vault/vault.html"
PASS = "integration test passphrase"


@pytest.fixture(scope="module")
def drv(umbra_app):
    d = start(umbra_app)
    yield d
    stop(d)


@pytest.fixture(scope="module")
def drv_logins(umbra_app):
    """A profile where the user has turned on saved logins (not Umbra's default)."""
    d = start(umbra_app, prefs={"security.nocertdb": False, "signon.rememberSignons": True})
    yield d
    stop(d)


def test_default_profile_has_no_logins_to_export(drv):
    drv.get(URL)
    time.sleep(1)
    assert drv.execute_script("return document.getElementById('x-logins').disabled") is True
    assert drv.find_element("id", "logins-note").is_displayed()
    assert chrome_eval(drv, "return Services.prefs.getBoolPref('security.nocertdb');") is True


def test_tools_menu_entry(drv):
    assert chrome_eval(drv, "return !!Services.wm.getMostRecentWindow('navigator:browser')"
                            ".document.getElementById('umbra-vault-menuitem');") is True


def test_page_renders_offline(drv):
    drv.get(URL)
    time.sleep(1)
    body = drv.find_element("tag name", "body").text
    for s in ("Umbra Vault", "AES-256-GCM", "PBKDF2", "Nothing is uploaded"):
        assert s in body, s
    csp = drv.execute_script("return document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
    assert "connect-src 'none'" in csp


def test_round_trip(drv_logins, tmp_path):
    drv = drv_logins
    # Wait for first-run default bookmarks import (it replaces existing bookmarks), then seed.
    chrome_eval(drv, """
        const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
        for (let i = 0; i < 100; i++) {
          if ((await PlacesUtils.bookmarks.fetch({ parentGuid: PlacesUtils.bookmarks.unfiledGuid, index: 0 }))) break;
          await new Promise(r => setTimeout(r, 100));
        }""")
    seeded = chrome_eval(drv, """
        const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
        await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.menuGuid,
          url: 'https://vault-test.example/', title: 'Vault test' });
        const i = Cc['@mozilla.org/login-manager/loginInfo;1'].createInstance(Ci.nsILoginInfo);
        i.init('https://vault-test.example', 'https://vault-test.example', null, 'alice', 's3cret', 'u', 'p');
        await Services.logins.addLoginAsync(i);
        return !!(await PlacesUtils.bookmarks.fetch({ url: 'https://vault-test.example/' }));""")
    assert seeded is True, seeded
    drv.get(URL)
    time.sleep(1)
    r = drv.execute_async_script(f"""
        const done = arguments[arguments.length - 1];
        window.UmbraVaultPage.buildExport({json.dumps(PASS)}, {{bookmarks: true, logins: true}})
          .then(done, e => done({{error: String(e)}}));""")
    assert "error" not in r, r
    assert r["bookmarks"] >= 1 and r["logins"] == 1
    f = json.loads(r["text"])
    assert f["format"] == "umbra-vault" and f["kdf"]["iterations"] == 600000
    assert "vault-test" not in r["text"] and "s3cret" not in r["text"]
    path = str(tmp_path / "x.umbravault")
    chrome_eval(drv, f"""const {{ UmbraVault }} = ChromeUtils.importESModule('resource:///modules/umbra/UmbraVault.sys.mjs');
        await UmbraVault.writeFile({json.dumps(path)}, {json.dumps(r['text'])});""")
    if os.name != "nt":
        assert oct(os.stat(path).st_mode & 0o777) == "0o600"
    # Wipe the login, then import.
    chrome_eval(drv, "await Services.logins.removeAllUserFacingLoginsAsync();")
    res = drv.execute_async_script(f"""
        const done = arguments[arguments.length - 1];
        window.UmbraVaultPage.importText({json.dumps(open(path).read())}, {json.dumps(PASS)})
          .then(done, e => done({{error: String(e)}}));""")
    assert "error" not in res, res
    assert res["logins"] == 1 and res["bookmarks"] >= 1
    logins = chrome_eval(drv, "return (await Services.logins.getAllLogins()).map(l => [l.origin, l.username, l.password]);")
    assert ["https://vault-test.example", "alice", "s3cret"] in logins
    titles = chrome_eval(drv, f"""
        const {{ PlacesUtils }} = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
        const t = await PlacesUtils.promiseBookmarksTree({json.dumps(res['folder'])});
        return JSON.stringify(t);""")
    assert "Umbra Vault import" in titles and "https://vault-test.example/" in titles
    # Importing again adds no duplicate logins.
    res2 = drv.execute_async_script(f"""
        const done = arguments[arguments.length - 1];
        window.UmbraVaultPage.importText({json.dumps(open(path).read())}, {json.dumps(PASS)})
          .then(done, e => done({{error: String(e)}}));""")
    assert res2["logins"] == 0


def test_wrong_passphrase(drv):
    drv.get(URL)
    time.sleep(1)
    r = drv.execute_async_script(f"""
        const done = arguments[arguments.length - 1];
        const w = window.UmbraVaultPage;
        w.buildExport({json.dumps(PASS)}, {{bookmarks: true, logins: false}})
          .then(x => w.importText(x.text, 'not the passphrase!'))
          .then(() => done('imported'), e => done(String(e)));""")
    assert "Wrong passphrase" in r
