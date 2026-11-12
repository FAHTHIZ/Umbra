import glob
import os
import shutil
import subprocess
import sys
import tarfile

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)


def _platform():
    """linux-x86_64 / linux-aarch64, overridable with UMBRA_PLATFORM."""
    import platform
    if os.environ.get("UMBRA_PLATFORM"):
        return os.environ["UMBRA_PLATFORM"]
    return "linux-aarch64" if platform.machine() in ("aarch64", "arm64") else "linux-x86_64"


def _find_app():
    env = os.environ.get("UMBRA_APP")
    if env:
        return env
    c = sorted(glob.glob(os.path.join(ROOT, "dist", f"umbra-*-{_platform()}", "umbra")))
    return c[-1] if c else None


def _upstream_app():
    env = os.environ.get("UPSTREAM_APP")
    if env:
        return env
    dst = os.path.join(ROOT, ".cache", "upstream-extracted")
    app = os.path.join(dst, "tor-browser")
    if not os.path.isdir(app):
        tb = sorted(glob.glob(os.path.join(ROOT, ".cache", f"tor-browser-{_platform()}-*.tar.xz")))
        if not tb:
            return None
        os.makedirs(dst, exist_ok=True)
        with tarfile.open(tb[-1]) as t:
            t.extractall(dst, filter="data")
    return app


@pytest.fixture(scope="session")
def umbra_app():
    app = _find_app()
    if not app:
        pytest.skip("no Umbra build found; run `python -m tools.umbra_build build` first")
    return app


@pytest.fixture(scope="session")
def upstream_app():
    app = _upstream_app()
    if not app:
        pytest.skip("upstream Tor Browser not available in .cache")
    return app
