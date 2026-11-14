"""Umbra for Android: the verified Tor Browser for Android APK, rebranded and re-signed.

Pipeline (logged into assets/UMBRA_BUILD.json inside the APK):
  1. verify   upstream APK: pinned SHA-256 + OpenPGP signature from the pinned Tor Browser key
  2. decode   resources and manifest with a pinned apktool (dex code, native libs and the
              GeckoView omni.ja are copied byte-for-byte, so the engine, tor and the
              anti-fingerprinting code are exactly upstream's)
  3. overlay  application id org.umbra.browser (installs next to Tor Browser), name, launcher
              icons, search engines (OnionSearch default + the desktop provider list)
  4. package  aapt2 rebuild, zipalign, APK Signature Scheme v2/v3 with Umbra's key

The engine is untouched, so the fingerprint a website sees is Tor Browser for Android's.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFilter

from . import UMBRA_VERSION
from .verify import VerificationError, sha256_file, verify_sha256

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OVERLAY = os.path.join(ROOT, "overlay")
UPSTREAM_ID = "org.torproject.torbrowser"
UMBRA_ID = "org.umbra.browser"
ANDROID_PLATFORMS = ("android-aarch64", "android-armv7", "android-x86_64")

# Launcher density buckets: (legacy icon px, adaptive foreground px)
DENSITIES = {"mdpi": (48, 108), "hdpi": (72, 162), "xhdpi": (96, 216), "xxhdpi": (144, 324), "xxxhdpi": (192, 432)}
BG = (11, 13, 18, 255)
AMBER = (246, 185, 74, 255)


class AndroidBuildError(RuntimeError):
    pass


# ---------------------------------------------------------------- tools

def _lock() -> dict:
    with open(os.path.join(ROOT, "upstream", "tor-browser.lock.json")) as f:
        return json.load(f)


def fetch_tool(name: str, cache: str) -> str:
    t = _lock()["android_tools"][name]
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, os.path.basename(t["url"]))
    if not os.path.exists(path):
        subprocess.run(["curl", "-sSfL", "--proto", "=https", "--tlsv1.2", "-o", path + ".part", t["url"]], check=True)
        os.replace(path + ".part", path)
    verify_sha256(path, t["sha256"])
    return path


def _which(*names: str) -> str:
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
    for n in names:
        p = shutil.which(n)
        if p:
            return p
        if sdk and os.path.isdir(os.path.join(sdk, "build-tools")):
            for v in sorted(os.listdir(os.path.join(sdk, "build-tools")), reverse=True):
                c = os.path.join(sdk, "build-tools", v, n)
                if os.path.exists(c):
                    return c
    raise AndroidBuildError(f"{names[0]} not found (install Android build-tools or the apksigner/zipalign packages)")


def _run(cmd, **kw):
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise AndroidBuildError(f"{os.path.basename(cmd[0])} {cmd[1:3]} failed: {(r.stderr or r.stdout)[-1500:]}")
    return r.stdout


# ---------------------------------------------------------------- manifest

def patch_manifest(text: str) -> str:
    """Give Umbra its own application id so it installs next to Tor Browser.

    Authorities, permissions, the shared user id and the androidx dynamic-receiver
    permission are all derived from the package name at runtime, so they move with it.
    Activity-alias *names* (launcher icon variants) are component names, not packages,
    and stay as they are.
    """
    if f'package="{UPSTREAM_ID}"' not in text:
        raise AndroidBuildError("upstream manifest package changed; review the Android overlay")

    def attr(m):
        name, val = m.group(1), m.group(2)
        if name in ("android:authorities", "android:sharedUserId", "android:permission", "android:readPermission",
                    "android:writePermission") or (name == "android:name" and ".permission." in val) \
                or (name == "android:name" and val.endswith("DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")):
            val = re.sub(r"(?<![\w.])" + re.escape(UPSTREAM_ID) + r"(?=$|[.;])", UMBRA_ID, val)
        return f'{name}="{val}"'

    out = re.sub(r'([\w:]+)="([^"]*)"', attr, text)
    # The package attribute itself is renamed by aapt2 --rename-manifest-package (apktool.yml),
    # which also keeps relative class names resolving against the original package.
    return out


def patch_apktool_yml(text: str, version_name: str) -> str:
    text = re.sub(r"versionName: .*", f"versionName: {version_name}", text)
    if "renameManifestPackage" in text:
        text = re.sub(r"renameManifestPackage: .*", f"renameManifestPackage: {UMBRA_ID}", text)
    else:
        text = text.replace("packageInfo:\n", f"packageInfo:\n  renameManifestPackage: {UMBRA_ID}\n", 1)
    return text


# ---------------------------------------------------------------- native libraries

# Android ships zlib as libz.so; there is no libz.so.1 on any Android release.
ANDROID_SONAME_FIXES = {b"libz.so.1": b"libz.so"}


def _needed(data: bytes) -> list:
    """DT_NEEDED names of a little-endian ELF64 or ELF32 shared object/executable."""
    import struct
    if data[:4] != b"\x7fELF":
        raise AndroidBuildError("not an ELF file")
    is64 = data[4] == 2
    if is64:
        shoff, = struct.unpack_from("<Q", data, 0x28)
        shentsize, shnum = struct.unpack_from("<HH", data, 0x3A)
    else:
        shoff, = struct.unpack_from("<I", data, 0x20)
        shentsize, shnum = struct.unpack_from("<HH", data, 0x2E)
    secs = []
    for i in range(shnum):
        o = shoff + i * shentsize
        if is64:
            name, typ, _flags, _addr, off, size, link = struct.unpack_from("<IIQQQQI", data, o)
        else:
            name, typ, _flags, _addr, off, size, link = struct.unpack_from("<IIIIIII", data, o)
        secs.append((typ, off, size, link))
    out = []
    for typ, off, size, link in secs:
        if typ != 6:  # SHT_DYNAMIC
            continue
        stroff = secs[link][1]
        fmt, step = ("<qQ", 16) if is64 else ("<iI", 8)
        for j in range(0, size, step):
            tag, val = struct.unpack_from(fmt, data, off + j)
            if tag == 0:
                break
            if tag == 1:  # DT_NEEDED
                end = data.index(b"\0", stroff + val)
                out.append((stroff + val, data[stroff + val:end]))
    return out


def fix_native_sonames(data: bytes) -> tuple[bytes, list]:
    """Point DT_NEEDED entries at libraries Android actually provides.

    Rewrites the name in place in .dynstr (the new name is shorter and NUL-padded),
    so no offsets, sizes or code change. Returns (data, [(old, new), ...]).
    """
    buf = bytearray(data)
    changes = []
    for off, name in _needed(data):
        new = ANDROID_SONAME_FIXES.get(name)
        if new:
            buf[off:off + len(name)] = new + b"\0" * (len(name) - len(new))
            changes.append((name.decode(), new.decode()))
    return bytes(buf), changes


# ---------------------------------------------------------------- strings

def brand_strings(text: str) -> str:
    """Rename the app. Only display strings change; resource names stay."""
    return text.replace("Tor Browser", "Umbra")


# ---------------------------------------------------------------- icons

def _mark(size: int, scale: float, background: bool) -> Image.Image:
    s = size * 4
    img = Image.new("RGBA", (s, s), BG if background else (0, 0, 0, 0))
    if background:
        m = Image.new("L", (s, s), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
        img.putalpha(m)
    c = s // 2
    R = int(s * scale / 2)
    corona = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(corona).ellipse([c - R, c - R, c + R, c + R], fill=AMBER)
    corona = corona.filter(ImageFilter.GaussianBlur(R * 0.08))
    img.alpha_composite(corona)
    r = int(R * 0.80)
    ImageDraw.Draw(img).ellipse([c - r, c - r, c + r, c + r], fill=BG)
    return img.resize((size, size), Image.LANCZOS)


def _webp(img: Image.Image) -> bytes:
    b = io.BytesIO()
    img.save(b, "WEBP", lossless=True, quality=100, method=6)
    return b.getvalue()


MONO_VECTOR = """<?xml version="1.0" encoding="utf-8"?>
<vector android:height="108.0dip" android:width="108.0dip" android:viewportWidth="108.0" android:viewportHeight="108.0"
  xmlns:android="http://schemas.android.com/apk/res/android">
    <path android:fillColor="#ff000000" android:fillType="evenOdd"
      android:pathData="M54,32A22,22 0,1 1,54 76A22,22 0,1 1,54 32ZM54,37A17,17 0,1 0,54 71A17,17 0,1 0,54 37Z" />
</vector>
"""
BG_VECTOR = """<?xml version="1.0" encoding="utf-8"?>
<vector android:height="108.0dip" android:width="108.0dip" android:viewportWidth="108.0" android:viewportHeight="108.0"
  xmlns:android="http://schemas.android.com/apk/res/android">
    <path android:fillColor="#ff0b0d12" android:pathData="M0,0h108v108h-108z" />
</vector>
"""


def write_icons(res: str) -> list:
    changed = []
    for d, (legacy, fg) in DENSITIES.items():
        folder = os.path.join(res, f"mipmap-{d}")
        if not os.path.isdir(folder):
            continue
        files = {"ic_launcher.webp": _mark(legacy, 0.74, True),
                 "ic_launcher_round.webp": _mark(legacy, 0.74, True),
                 # adaptive foreground: keep the mark inside the 66/108 safe zone
                 "ic_launcher_foreground.webp": _mark(fg, 0.50, False),
                 "ic_launcher_monochrome.webp": _mark(legacy, 0.74, False).convert("LA").convert("RGBA")}
        for name, img in files.items():
            p = os.path.join(folder, name)
            if os.path.exists(p):
                with open(p, "wb") as f:
                    f.write(_webp(img))
                changed.append(os.path.relpath(p, res))
    for name, body in (("ic_launcher_background.xml", BG_VECTOR), ("ic_launcher_monochrome_foreground.xml", MONO_VECTOR)):
        p = os.path.join(res, "drawable", name)
        if os.path.exists(p):
            with open(p, "w") as f:
                f.write(body)
            changed.append(os.path.relpath(p, res))
    return changed


# ---------------------------------------------------------------- search

def _letter_icon(letter: str, bg: str) -> str:
    s = 128
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=32, fill=bg)
    try:
        from PIL import ImageFont
        font = ImageFont.load_default(size=78)
    except Exception:  # pragma: no cover - very old Pillow
        font = None
    d.text((s / 2, s / 2 + 2), letter, fill="#ffffff", anchor="mm", font=font)
    img = img.resize((32, 32), Image.LANCZOS)
    b = io.BytesIO()
    img.save(b, "PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


ENGINE_ICONS = {"onionsearch": ("O", "#7D4698"), "ddg-noai": ("D", "#DE5833"), "brave": ("B", "#FB542B"),
                "brave-onion": ("B", "#FB542B"), "ecosia": ("E", "#008009"), "google": ("G", "#4285F4"),
                "mojeek": ("M", "#2D6CDF")}


def _url_xml(kind: str, u: dict) -> str:
    params = "".join(f'\n  <Param name="{escape(p["name"])}" value="{escape(p["value"])}"/>' for p in u.get("params", []))
    term = u.get("searchTermParamName")
    if term:
        params += f'\n  <Param name="{escape(term)}" value="{{searchTerms}}"/>'
    return f'<Url type="{kind}" method="GET" template="{escape(u["base"])}">{params}\n</Url>\n'


def opensearch_xml(engine: dict, upstream_image: str | None) -> str:
    b = engine["base"]
    ident = engine["identifier"]
    image = upstream_image or _letter_icon(*ENGINE_ICONS.get(ident, (b["name"][0], "#555555")))
    out = ['<SearchPlugin xmlns="http://www.mozilla.org/2006/browser/search/">\n',
           f"<ShortName>{escape(b['name'])}</ShortName>\n",
           "<InputEncoding>UTF-8</InputEncoding>\n",
           f'<Image width="32" height="32">{image}</Image>\n']
    if "suggestions" in b["urls"]:
        out.append(_url_xml("application/x-suggestions+json", b["urls"]["suggestions"]))
    out.append(_url_xml("text/html", b["urls"]["search"]))
    out.append(f"<SearchForm>{escape(b['urls']['search']['base'])}</SearchForm>\n</SearchPlugin>\n")
    return "".join(out)


def search_assets(upstream_plugins: dict) -> dict:
    """Return {asset path: bytes} for assets/search and assets/searchplugins."""
    with open(os.path.join(OVERLAY, "search", "umbra-search-engines.json")) as f:
        cfg = json.load(f)
    engines = {e["identifier"]: e for e in cfg if e.get("recordType") == "engine"}
    order = next(r for r in cfg if r.get("recordType") == "engineOrders")["orders"][0]["order"]
    default = next(r for r in cfg if r.get("recordType") == "defaultEngines")["globalDefault"]
    out = {}
    for ident in order:
        img = None
        up = upstream_plugins.get(ident)
        if up:
            m = re.search(r"<Image[^>]*>([^<]+)</Image>", up)
            img = m.group(1) if m else None
        out[f"searchplugins/{ident}.xml"] = opensearch_xml(engines[ident], img).encode()
    names = [engines[i]["base"]["name"] for i in order]
    out["search/list.json"] = (json.dumps({"default": {"searchDefault": engines[default]["base"]["name"],
                                                       "searchOrder": names, "visibleDefaultEngines": list(order)},
                                           "regionOverrides": {}, "locales": {}}, indent=2) + "\n").encode()
    return out


# ---------------------------------------------------------------- signing

def signing_config(work: str) -> dict:
    """Umbra release key from the environment, or a throwaway test key.

    UMBRA_ANDROID_KEYSTORE      path to a PKCS#12/JKS keystore (or UMBRA_ANDROID_KEYSTORE_B64)
    UMBRA_ANDROID_KEYSTORE_PASS keystore password
    UMBRA_ANDROID_KEY_ALIAS     key alias (default: umbra)
    UMBRA_ANDROID_KEY_PASS      key password (default: keystore password)
    """
    ks = os.environ.get("UMBRA_ANDROID_KEYSTORE")
    b64 = os.environ.get("UMBRA_ANDROID_KEYSTORE_B64")
    if not ks and b64:
        ks = os.path.join(work, "release.keystore")
        with open(ks, "wb") as f:
            f.write(base64.b64decode(b64))
    if ks:
        pw = os.environ["UMBRA_ANDROID_KEYSTORE_PASS"]
        return {"keystore": ks, "alias": os.environ.get("UMBRA_ANDROID_KEY_ALIAS", "umbra"), "store_pass": pw,
                "key_pass": os.environ.get("UMBRA_ANDROID_KEY_PASS", pw), "kind": "release"}
    ks = os.path.join(work, "test.keystore")
    _run(["keytool", "-genkeypair", "-keystore", ks, "-storetype", "PKCS12", "-alias", "umbra", "-keyalg", "RSA",
          "-keysize", "3072", "-validity", "10000", "-storepass", "umbra-test", "-keypass", "umbra-test",
          "-dname", "CN=Umbra test build (not for distribution)"])
    return {"keystore": ks, "alias": "umbra", "store_pass": "umbra-test", "key_pass": "umbra-test", "kind": "test"}


def cert_sha256(apk: str) -> str:
    out = _run([_which("apksigner"), "verify", "--print-certs", apk])
    m = re.search(r"certificate SHA-256 digest: ([0-9a-f]{64})", out)
    return m.group(1) if m else ""


# ---------------------------------------------------------------- build

def build_android(platform: str, cache: str | None = None, out_dir: str | None = None) -> dict:
    from .build import fetch
    if platform not in ANDROID_PLATFORMS:
        raise AndroidBuildError(f"unknown Android platform {platform}")
    cache = cache or os.path.join(ROOT, ".cache")
    out_dir = out_dir or os.path.join(ROOT, "dist")
    os.makedirs(out_dir, exist_ok=True)
    lock = _lock()
    apk = fetch(platform, cache)            # pinned SHA-256 + OpenPGP, raises on mismatch
    apktool = fetch_tool("apktool", cache)  # pinned SHA-256
    report = {"umbra_version": UMBRA_VERSION, "platform": platform, "application_id": UMBRA_ID,
              "upstream": {"version": lock["version"], "file": os.path.basename(apk), "sha256": sha256_file(apk),
                           "signing_key": lock["signing_key_fingerprint"]}, "changes": []}
    with tempfile.TemporaryDirectory(dir=out_dir) as work:
        dec = os.path.join(work, "dec")
        _run(["java", "-jar", apktool, "d", "-s", "-f", "-o", dec, apk])

        man = os.path.join(dec, "AndroidManifest.xml")
        with open(man) as f:
            text = f.read()
        with open(man, "w") as f:
            f.write(patch_manifest(text))
        report["changes"].append("AndroidManifest.xml: application id, authorities, permissions")

        yml = os.path.join(dec, "apktool.yml")
        with open(yml) as f:
            text = f.read()
        vname = f"{UMBRA_VERSION} (Tor Browser {lock['version']})"
        with open(yml, "w") as f:
            f.write(patch_apktool_yml(text, vname))
        report["version_name"] = vname

        res = os.path.join(dec, "res")
        n = 0
        for d in sorted(os.listdir(res)):
            p = os.path.join(res, d, "strings.xml")
            if d.startswith("values") and os.path.exists(p):
                with open(p, encoding="utf-8") as f:
                    s = f.read()
                t = brand_strings(s)
                if t != s:
                    with open(p, "w", encoding="utf-8") as f:
                        f.write(t)
                    n += 1
        report["changes"].append(f"strings: app name in {n} locales")
        report["changes"] += ["icon: " + c for c in write_icons(res)]

        libroot = os.path.join(dec, "lib")
        for abi in sorted(os.listdir(libroot)) if os.path.isdir(libroot) else []:
            for fn in sorted(os.listdir(os.path.join(libroot, abi))):
                p = os.path.join(libroot, abi, fn)
                with open(p, "rb") as f:
                    data = f.read()
                fixed, ch = fix_native_sonames(data)
                if ch:
                    with open(p, "wb") as f:
                        f.write(fixed)
                    report["changes"] += [f"lib/{abi}/{fn}: DT_NEEDED {a} -> {b}" for a, b in ch]
                    report.setdefault("native_fixes", []).append({"file": f"lib/{abi}/{fn}", "needed": ch,
                                                                  "upstream_sha256": hashlib.sha256(data).hexdigest(),
                                                                  "sha256": hashlib.sha256(fixed).hexdigest()})

        assets = os.path.join(dec, "assets")
        plugdir = os.path.join(assets, "searchplugins")
        upstream_plugins = {}
        for fn in os.listdir(plugdir):
            with open(os.path.join(plugdir, fn), encoding="utf-8") as f:
                upstream_plugins[fn[:-4]] = f.read()
        for rel, data in search_assets(upstream_plugins).items():
            with open(os.path.join(assets, rel), "wb") as f:
                f.write(data)
            report["changes"].append("assets/" + rel)

        with open(os.path.join(ROOT, "overlay", "explore", "curated-onions.json"), "rb") as f:
            explore = f.read()
        with open(os.path.join(assets, "umbra-explore.json"), "wb") as f:
            f.write(explore)

        omni_sha = sha256_file(os.path.join(assets, "omni.ja.xz"))
        report["engine_unchanged"] = {"assets/omni.ja.xz": omni_sha}
        with open(os.path.join(assets, "UMBRA_BUILD.json"), "w") as f:
            json.dump(report, f, indent=1, sort_keys=True)

        unsigned = os.path.join(work, "unsigned.apk")
        _run(["java", "-jar", apktool, "b", "-o", unsigned, dec])
        aligned = os.path.join(work, "aligned.apk")
        _run([_which("zipalign"), "-f", "-p", "4", unsigned, aligned])
        sc = signing_config(work)
        name = f"umbra-{UMBRA_VERSION}-{platform}{'' if sc['kind'] == 'release' else '-testsigned'}.apk"
        final = os.path.join(out_dir, name)
        _run([_which("apksigner"), "sign", "--ks", sc["keystore"], "--ks-key-alias", sc["alias"],
              "--ks-pass", "pass:" + sc["store_pass"], "--key-pass", "pass:" + sc["key_pass"],
              "--v1-signing-enabled", "false", "--v2-signing-enabled", "true", "--v3-signing-enabled", "true",
              "--out", final, aligned])
        _run([_which("apksigner"), "verify", final])
    if os.path.exists(final + ".idsig"):
        os.remove(final + ".idsig")
    report["signing"] = {"kind": sc["kind"], "cert_sha256": cert_sha256(final)}
    report["package"] = {"file": name, "sha256": sha256_file(final), "bytes": os.path.getsize(final)}
    _append_sums(out_dir, report["package"])
    with open(os.path.join(out_dir, name + ".json"), "w") as f:
        json.dump(report, f, indent=1, sort_keys=True)
    return report


def _append_sums(out_dir: str, pkg: dict) -> None:
    sums = os.path.join(out_dir, "SHA256SUMS")
    lines = open(sums).read().splitlines() if os.path.exists(sums) else []
    lines = [l for l in lines if not l.endswith("  " + pkg["file"])]
    lines.append(f"{pkg['sha256']}  {pkg['file']}")
    with open(sums, "w") as f:
        f.write("\n".join(sorted(lines, key=lambda l: l.split("  ", 1)[-1])) + "\n")


def inspect_apk(path: str) -> dict:
    """Read back what an Umbra APK contains (used by tests and the release checklist)."""
    import zipfile
    z = zipfile.ZipFile(path)
    return {"build": json.loads(z.read("assets/UMBRA_BUILD.json")),
            "search_list": json.loads(z.read("assets/search/list.json")),
            "omni_sha256": hashlib.sha256(z.read("assets/omni.ja.xz")).hexdigest(),
            "names": z.namelist()}


__all__ = ["build_android", "inspect_apk", "patch_manifest", "patch_apktool_yml", "brand_strings", "search_assets",
           "opensearch_xml", "AndroidBuildError", "VerificationError", "ANDROID_PLATFORMS", "UMBRA_ID"]
