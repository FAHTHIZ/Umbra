"""Build Umbra from a verified Tor Browser release.

Pipeline (each step is logged into UMBRA_BUILD.json):
  1. verify   upstream tarball: pinned SHA-256 + OpenPGP sig from pinned key
  2. extract  into a clean staging dir
  3. overlay  search config, home page, branding, prefs, policies
  4. package  deterministic tar.xz + SHA256SUMS
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tarfile

from . import UMBRA_VERSION
from .branding import TRADEMARK, brand_ftl, brand_properties, icon_png
from .omni import Omni
from .verify import sha256_file, verify_sha256, verify_signature

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OVERLAY = os.path.join(ROOT, "overlay")
LOCK = os.path.join(ROOT, "upstream", "tor-browser.lock.json")

ABOUTTOR = "chrome/browser/content/browser/abouttor/"
SEARCH_CFG = "chrome/toolkit/content/global/search/base-browser-search-engines.json"
SEARCH_ICONS = "chrome/toolkit/content/global/search/base-browser-search-engine-icons.json"
ICON_DIR = "chrome/toolkit/content/global/search/"


def load_lock():
    with open(LOCK) as f:
        return json.load(f)


def fetch(platform: str, cache: str) -> str:
    lock = load_lock()
    art = lock["artifacts"][platform]
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, art["file"])
    for p, url in ((path, lock["base_url"] + art["file"]), (path + ".asc", lock["base_url"] + art["file"] + ".asc")):
        if not os.path.exists(p):
            subprocess.run(["curl", "-sSfL", "--proto", "=https", "--tlsv1.2", "-o", p + ".part", url], check=True)
            os.replace(p + ".part", p)
    verify_sha256(path, art["sha256"])
    verify_signature(path, path + ".asc", lock["signing_key_fingerprint"], lock["signing_key_wkd"])
    return path


def _engine_icon_svg(letter: str, bg: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="{bg}"/>'
            f'<text x="16" y="22" font-family="sans-serif" font-size="17" font-weight="700" text-anchor="middle" fill="#fff">{letter}</text></svg>')


ENGINE_ICONS = {"onionsearch": ("O", "#7D4698"), "brave": ("B", "#FB542B"), "brave-onion": ("B", "#FB542B"),
                "ecosia": ("E", "#008009"), "google": ("G", "#4285F4"), "mojeek": ("M", "#2D6CDF")}


def patch_toolkit_omni(omni: Omni) -> None:
    engines = open(os.path.join(OVERLAY, "search", "umbra-search-engines.json")).read()
    json.loads(engines)
    omni.put(SEARCH_CFG, engines, "search engines: OnionSearch default + providers")
    icons = json.loads(omni.text(SEARCH_ICONS))
    for ident, (letter, bg) in ENGINE_ICONS.items():
        name = f"{ICON_DIR}umbra-{ident}.svg"
        omni.put(name, _engine_icon_svg(letter, bg), "engine icon")
        icons[ident] = [{"url": "chrome://global/content/search/" + f"umbra-{ident}.svg", "imageSize": 32}]
    omni.put(SEARCH_ICONS, json.dumps(icons, indent=2), "engine icons map")
    # Toolkit-level brand strings (some locales/UI read these).
    for n in omni.names(suffix="branding/brand.ftl"):
        omni.edit_text(n, brand_ftl, "branding")


ACCESS_CATEGORY = (
    "category browser-first-window-ready "
    "resource:///modules/umbra/AccessEngine.sys.mjs UmbraAccessEngine.init"
)


def patch_access_omni(omni: Omni) -> None:
    """Package the native Access Engine into browser/omni.ja.

    - modules/umbra/*.sys.mjs           -> resource:///modules/umbra/
    - chrome/browser/content/browser/umbra-access/* -> chrome://browser/content/umbra-access/
      (the "browser" chrome package maps to browser/content/browser/)
    - startup hook: one category line in components/components.manifest
      (Tor Browser 16 has no on-disk BrowserComponents.manifest).
    """
    access = os.path.join(OVERLAY, "access")
    for name in sorted(os.listdir(access)):
        with open(os.path.join(access, name), "rb") as f:
            data = f.read()
        if name.endswith(".sys.mjs"):
            omni.put("modules/umbra/" + name, data, "Umbra Access Engine module")
        elif name.endswith((".js", ".html", ".css", ".svg")):
            omni.put("chrome/browser/content/browser/umbra-access/" + name, data, "Umbra Access Engine UI")

    def add_category(text: str) -> str:
        if ACCESS_CATEGORY in text:
            return text
        if "category browser-first-window-ready" not in text:
            raise PatchError("components.manifest has no browser-first-window-ready entries; upstream changed")
        return text.rstrip("\n") + "\n" + ACCESS_CATEGORY + "\n"

    omni.edit_text("components/components.manifest", add_category, "Umbra Access Engine startup")


PRIVACY_CATEGORY = (
    "category browser-first-window-ready "
    "resource:///modules/umbra/UmbraPrivacy.sys.mjs UmbraPrivacy.init"
)


def add_first_window_category(omni: Omni, entry: str, why: str) -> None:
    """Append one browser-first-window-ready line to components.manifest (idempotent)."""
    def edit(text: str) -> str:
        if entry in text:
            return text
        if "category browser-first-window-ready" not in text:
            raise PatchError("components.manifest has no browser-first-window-ready entries; upstream changed")
        return text.rstrip("\n") + "\n" + entry + "\n"
    omni.edit_text("components/components.manifest", edit, why)


def patch_privacy_omni(omni: Omni) -> None:
    """Umbra Privacy dashboard -> chrome://browser/content/umbra-privacy/, Tools menu hook."""
    src = os.path.join(OVERLAY, "privacy")
    for name in sorted(os.listdir(src)):
        with open(os.path.join(src, name), "rb") as f:
            data = f.read()
        if name.endswith(".sys.mjs"):
            omni.put("modules/umbra/" + name, data, "Umbra Privacy module")
        else:
            omni.put("chrome/browser/content/browser/umbra-privacy/" + name, data, "Umbra Privacy dashboard")
    add_first_window_category(omni, PRIVACY_CATEGORY, "Umbra Privacy startup")


SOURCE_CATEGORY = (
    "category browser-first-window-ready "
    "resource:///modules/umbra/UmbraSource.sys.mjs UmbraSource.init"
)


def patch_source_omni(omni: Omni) -> None:
    """Umbra Source (SecureDrop directory + isolated launcher) -> chrome://browser/content/umbra-source/."""
    src = os.path.join(OVERLAY, "source")
    for name in sorted(os.listdir(src)):
        with open(os.path.join(src, name), "rb") as f:
            data = f.read()
        if name.endswith(".sys.mjs"):
            omni.put("modules/umbra/" + name, data, "Umbra Source module")
        else:
            omni.put("chrome/browser/content/browser/umbra-source/" + name, data, "Umbra Source page")
    add_first_window_category(omni, SOURCE_CATEGORY, "Umbra Source startup")


UPDATE_CATEGORY = (
    "category browser-first-window-ready "
    "resource:///modules/umbra/UmbraUpdateNotice.sys.mjs UmbraUpdateNotice.init"
)


def patch_update_omni(omni: Omni) -> None:
    """Release notice (Umbra disables the upstream MAR updater)."""
    src = os.path.join(OVERLAY, "update")
    omni.put("modules/umbra/UmbraUpdateNotice.sys.mjs", open(os.path.join(src, "UmbraUpdateNotice.sys.mjs"), "rb").read(), "Umbra update notice")
    omni.put("modules/umbra/update-version.mjs", open(os.path.join(src, "version.mjs"), "rb").read(), "Umbra update notice")
    add_first_window_category(omni, UPDATE_CATEGORY, "Umbra update notice startup")


def patch_browser_omni(omni: Omni, upstream_version: str) -> None:
    home = os.path.join(OVERLAY, "home")
    for f in sorted(os.listdir(home)):
        omni.put(ABOUTTOR + f, open(os.path.join(home, f), "rb").read(), "Umbra home")
    for n in omni.names(suffix="branding/brand.ftl"):
        omni.edit_text(n, brand_ftl, "branding")
    for n in omni.names(suffix="locale/branding/brand.properties"):
        omni.edit_text(n, brand_properties, "branding")
    for size in (16, 32, 48, 64, 128, 256):
        omni.put(f"chrome/browser/content/branding/icon{size}.png", icon_png(size), "icon")
    omni.put("chrome/browser/content/branding/about-logo.png", icon_png(192), "logo")
    omni.put("chrome/browser/content/branding/about-logo@2x.png", icon_png(384), "logo")
    svg = open(os.path.join(home, "umbra-mark.svg")).read()
    omni.put("chrome/browser/content/branding/about-logo.svg", svg, "logo")
    omni.put("chrome/browser/content/branding/about-logo-small.svg", svg, "logo")
    prefs = open(os.path.join(OVERLAY, "prefs", "umbra-prefs.js")).read()
    prefs = prefs.replace("@UMBRA_VERSION@", UMBRA_VERSION).replace("@UPSTREAM_VERSION@", upstream_version)
    omni.put("defaults/preferences/umbra-prefs.js", prefs, "Umbra prefs layer")
    patch_access_omni(omni)
    patch_privacy_omni(omni)
    patch_source_omni(omni)
    patch_update_omni(omni)


class PatchError(RuntimeError):
    pass


def apply_source_patches(omni: Omni, archive: str) -> None:
    spec = json.load(open(os.path.join(OVERLAY, "patches", "patches.json")))
    for p in spec["patches"]:
        if p["archive"] != archive:
            continue
        src = omni.text(p["file"])
        n = src.count(p["find"])
        if n != 1:
            raise PatchError(f"patch {p['id']}: anchor found {n} times in {p['file']} (expected 1); upstream changed?")
        omni.put(p["file"], src.replace(p["find"], p["replace"]), "patch " + p["id"])


def patch_tree(app: str) -> None:
    """Files outside omni.ja: window icons, launchers, notices.

    NOTE: Umbra deliberately ships NO enterprise policies.json. Activating any
    policy flips dom.webserial.enabled and makes Umbra fingerprintable vs
    upstream Tor Browser (caught by tests/integration/test_parity.py).
    """
    # Register the Access Engine through Gecko's startup category manager.

    icons = os.path.join(app, "Browser", "browser", "chrome", "icons", "default")
    if os.path.isfile(os.path.join(app, "Browser", "firefox.exe")):
        # Windows: Gecko loads per-window .ico files from this folder if present
        # (the .exe resource icon stays upstream's; changing it would break the
        # Authenticode signature). Plus a launcher next to Browser/.
        import io
        from PIL import Image
        os.makedirs(icons, exist_ok=True)
        img = Image.open(io.BytesIO(icon_png(256)))
        for name in ("main-window.ico", "default.ico"):
            img.save(os.path.join(icons, name), format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        with open(os.path.join(app, "Start Umbra.cmd"), "w", newline="\r\n") as f:
            f.write('@echo off\nstart "" "%~dp0Browser\\firefox.exe" %*\n')
    else:
        for size in (16, 32, 48, 64, 128):
            with open(os.path.join(icons, f"default{size}.png"), "wb") as f:
                f.write(icon_png(size))
    for desktop in (os.path.join(app, "start-tor-browser.desktop"), os.path.join(app, "Browser", "start-tor-browser.desktop")):
        if os.path.exists(desktop):
            t = open(desktop).read()
            t = t.replace("Name=Tor Browser Setup", "Name=Umbra").replace("Name=Tor Browser", "Name=Umbra")
            t = "\n".join(("Comment=Umbra: a privacy-first browser built on Tor Browser" if l.startswith("Comment=") else l)
                          for l in t.splitlines()) + "\n"
            open(desktop, "w").write(t)
            os.rename(desktop, desktop.replace("start-tor-browser.desktop", "start-umbra.desktop"))
    with open(os.path.join(app, "Browser", "umbra_version.json"), "w") as f:
        json.dump({"umbra": UMBRA_VERSION, "upstream": json.load(open(os.path.join(app, "Browser", "tbb_version.json")))}, f)
    with open(os.path.join(app, "NOTICE.txt"), "w") as f:
        f.write(TRADEMARK + "\n\nSource: https://github.com/FAHTHIZ/Umbra\nUpstream source: "
                "https://gitlab.torproject.org/tpo/applications/tor-browser\nLicenses: see Browser/ and upstream (MPL-2.0 and others).\n")


def deterministic_tar(src_dir: str, out: str) -> None:
    def norm(ti: tarfile.TarInfo):
        ti.uid = ti.gid = 0
        ti.uname = ti.gname = ""
        ti.mtime = 946684800
        return ti
    with tarfile.open(out, "w:xz", preset=6) as tar:
        base = os.path.basename(src_dir)
        for dirpath, dirnames, filenames in os.walk(src_dir):
            dirnames.sort()
            rel = os.path.relpath(dirpath, os.path.dirname(src_dir))
            tar.add(dirpath, arcname=rel, recursive=False, filter=norm)
            for fn in sorted(filenames):
                tar.add(os.path.join(dirpath, fn), arcname=os.path.join(rel, fn), filter=norm)


def extract_upstream(archive: str, stage: str, app: str) -> None:
    """Linux: tar.xz with a tor-browser/ root. Windows: NSIS portable .exe (7z can read it)."""
    if archive.endswith(".exe"):
        seven = (shutil.which("7z") or shutil.which("7za") or shutil.which("7zz")
                 or next((p for p in (r"C:\Program Files\7-Zip\7z.exe",) if os.path.isfile(p)), None))
        if not seven:
            raise RuntimeError("Windows builds need 7-Zip (7z) to unpack the upstream NSIS installer")
        subprocess.run([seven, "x", "-y", "-bso0", "-bsp0", f"-o{app}", archive, "-x!$PLUGINSDIR"], check=True)
        return
    with tarfile.open(archive) as t:
        t.extractall(stage, filter="data")
    os.rename(os.path.join(stage, "tor-browser"), app)


def deterministic_zip(src_dir: str, out: str, root: str = "Umbra") -> None:
    """Byte-reproducible zip: sorted entries, fixed timestamps, no extra attrs."""
    import zipfile
    entries = []
    for dp, dns, fns in os.walk(src_dir):
        dns.sort()
        for fn in sorted(fns):
            full = os.path.join(dp, fn)
            entries.append((os.path.relpath(full, src_dir).replace(os.sep, "/"), full))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel, full in sorted(entries):
            zi = zipfile.ZipInfo(f"{root}/{rel}", date_time=(2000, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            with open(full, "rb") as f:
                z.writestr(zi, f.read())


def build(platform: str = "linux-x86_64", cache: str = None, out_dir: str = None, package: bool = True) -> dict:
    cache = cache or os.path.join(ROOT, ".cache")
    out_dir = out_dir or os.path.join(ROOT, "dist")
    lock = load_lock()
    tarball = fetch(platform, cache)
    stage = os.path.join(out_dir, f"umbra-{UMBRA_VERSION}-{platform}")
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    app = os.path.join(stage, "umbra")
    extract_upstream(tarball, stage, app)

    report = {"umbra_version": UMBRA_VERSION, "platform": platform, "upstream": {
        "version": lock["version"], "file": os.path.basename(tarball), "sha256": sha256_file(tarball),
        "signing_key": lock["signing_key_fingerprint"]}, "changes": {}}
    for rel, patcher in (("Browser/omni.ja", patch_toolkit_omni), ("Browser/browser/omni.ja", None)):
        o = Omni(os.path.join(app, rel))
        if patcher:
            patcher(o)
        else:
            patch_browser_omni(o, lock["version"])
        apply_source_patches(o, rel)
        o.save()
        report["changes"][rel] = o.changed
    patch_tree(app)
    report["overlay_sha256"] = {r: sha256_file(os.path.join(app, r)) for r in ("Browser/omni.ja", "Browser/browser/omni.ja")}
    with open(os.path.join(app, "Browser", "UMBRA_BUILD.json"), "w") as f:
        json.dump(report, f, indent=1, sort_keys=True)
    if package:
        if platform.startswith("windows"):
            pkg = os.path.join(out_dir, f"umbra-{UMBRA_VERSION}-{platform}.zip")
            deterministic_zip(app, pkg)
        else:
            pkg = os.path.join(out_dir, f"umbra-{UMBRA_VERSION}-{platform}.tar.xz")
            deterministic_tar(app, pkg)
        report["package"] = {"file": os.path.basename(pkg), "sha256": sha256_file(pkg)}
        sums = os.path.join(out_dir, "SHA256SUMS")
        lines = open(sums).read().splitlines() if os.path.exists(sums) else []
        lines = [l for l in lines if not l.endswith("  " + report["package"]["file"])]
        lines.append(f"{report['package']['sha256']}  {report['package']['file']}")
        with open(sums, "w") as f:
            f.write("\n".join(sorted(lines, key=lambda l: l.split("  ", 1)[-1])) + "\n")
    report["app_dir"] = app
    return report
