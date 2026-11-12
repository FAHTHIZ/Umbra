"""Headless Selenium/Marionette driver for Umbra and upstream Tor Browser."""
import os
import shutil
import tempfile

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service


def geckodriver_path():
    return os.environ.get("GECKODRIVER") or shutil.which("geckodriver") or os.path.expanduser("~/bin/geckodriver")


def start(app_dir, prefs=None, env=None, tor_provider="none"):
    """Launch the browser in app_dir. tor_provider='none' means Tor is not
    launched by the browser and the SOCKS proxy prefs are used as-is."""
    opts = Options()
    opts.binary_location = os.path.join(app_dir, "Browser", "firefox.real")
    opts.add_argument("--headless")
    opts.add_argument("-remote-allow-system-access")
    profile = tempfile.mkdtemp(prefix="umbra-test-")
    opts.add_argument("-profile")
    opts.add_argument(profile)
    for k, v in (prefs or {}).items():
        opts.set_preference(k, v)
    environ = dict(os.environ, MOZ_HEADLESS="1")
    if tor_provider:
        environ["TOR_PROVIDER"] = tor_provider
    else:
        environ.pop("TOR_PROVIDER", None)
    environ.update(env or {})
    service = Service(geckodriver_path(), env=environ)
    drv = webdriver.Firefox(options=opts, service=service)
    drv._umbra_profile = profile
    return drv


def chrome_eval(drv, script, *args):
    with drv.context(drv.CONTEXT_CHROME):
        return drv.execute_async_script(
            "const done = arguments[arguments.length-1];"
            "(async () => {" + script + "})().then(done, e => done({__error: String(e)}));", *args)


def stop(drv):
    prof = getattr(drv, "_umbra_profile", None)
    try:
        drv.quit()
    finally:
        if prof:
            shutil.rmtree(prof, ignore_errors=True)
