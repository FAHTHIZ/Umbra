#!/usr/bin/env python3
"""Android smoke test for an Umbra APK on an emulator (run by CI, also works on a USB device).

  python tests/android/smoke.py dist/umbra-0.1.0-android-x86_64*.apk --out android-artifacts [--tor]

Checks, in order (each failure is fatal unless noted):
  1. the APK installs as org.umbra.browser, next to (not over) Tor Browser
  2. the launcher starts it and the process stays alive, with no FATAL EXCEPTION
  3. the app is called "Umbra" in the launcher label
  4. --tor: tapping Connect bootstraps Tor and a page loads over it (screenshots recorded)
Screenshots and UI dumps go to --out for review.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time

PKG = "org.umbra.browser"
LABEL = "Umbra"
TOR_DEAD = "The Tor process has stopped working"


def adb(*args, check=True, timeout=120) -> str:
    r = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise SystemExit(f"adb {' '.join(args)} failed: {r.stderr or r.stdout}")
    return r.stdout


def shot(out: str, name: str) -> None:
    dst = os.path.join(out, name + ".png")
    adb("shell", "screencap", "-p", "/data/local/tmp/shot.png", check=False)
    adb("pull", "/data/local/tmp/shot.png", dst, check=False)
    if not os.path.exists(dst) or os.path.getsize(dst) < 100:
        # headless swiftshader emulators often return an empty framebuffer to screencap
        adb("emu", "screenrecord", "screenshot", os.path.abspath(dst), check=False)
    print(f"   screenshot {name}: {os.path.getsize(dst) if os.path.exists(dst) else 0} bytes")


def ui(out: str, name: str) -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/ui.xml", check=False)
    x = adb("shell", "cat", "/sdcard/ui.xml", check=False)
    with open(os.path.join(out, name + ".xml"), "w") as f:
        f.write(x)
    return x


def nodes(xml: str):
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml[xml.index("<?xml"):] if "<?xml" in xml else xml)
    except (ET.ParseError, ValueError):
        return []
    return list(root.iter("node"))


def texts(xml: str) -> list:
    return [t for n in nodes(xml) for t in (n.get("text"), n.get("content-desc")) if t]


def tap_text(xml: str, labels) -> str | None:
    # prefer clickable widgets (a "Connect" icon and a "Connect" button can share a label)
    all_nodes = sorted(nodes(xml), key=lambda n: n.get("clickable") != "true")
    for label in labels:
        for n in all_nodes:
            if label.lower() in ((n.get("text") or "").strip().lower(), (n.get("content-desc") or "").strip().lower()):
                m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
                if m:
                    x1, y1, x2, y2 = map(int, m.groups())
                    adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
                    return label
    return None


def tap_id(xml: str, rid: str) -> bool:
    for n in nodes(xml):
        if n.get("resource-id") == rid:
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
            if m:
                x1, y1, x2, y2 = map(int, m.groups())
                adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
                return True
    return False


def type_in_address_bar(out: str, text: str) -> bool:
    """Type into the toolbar the way a user would, then press Enter."""
    x = ui(out, "toolbar")
    if not tap_id(x, "ADDRESSBAR_URL_BOX") and not tap_text(x, ["Search or enter address"]):
        return False
    time.sleep(2)
    adb("shell", "input", "text", text.replace(" ", "%s"))
    time.sleep(1)
    adb("shell", "input", "keyevent", "66")
    return True


def wait_for_text(out: str, name: str, needle: str, seconds: int = 120) -> str:
    deadline = time.time() + seconds
    t = ""
    while time.time() < deadline:
        time.sleep(8)
        t = " | ".join(texts(ui(out, name)))
        if needle.lower() in t.lower():
            return t
    return ""


def find_aapt2() -> str:
    import shutil
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT") or ""
    bt = os.path.join(sdk, "build-tools")
    if os.path.isdir(bt):
        for v in sorted(os.listdir(bt), reverse=True):
            if os.path.exists(os.path.join(bt, v, "aapt2")):
                return os.path.join(bt, v, "aapt2")
    return shutil.which("aapt2") or "aapt2"


def alive() -> bool:
    return bool(adb("shell", "pidof", PKG, check=False).strip())


def crashed() -> str:
    log = adb("logcat", "-d", "-b", "crash", check=False)
    return log if PKG in log and "FATAL EXCEPTION" in log else ""


def save_tor_log(out: str) -> None:
    log = adb("logcat", "-d", check=False)
    with open(os.path.join(out, "logcat.txt"), "w") as f:
        f.write(log)
    for line in log.splitlines():
        if re.search(r"CANNOT LINK|Bootstrapped|\[(warn|err)\]", line):
            print("   log:", line[-220:])


def bootstrap_progress() -> int:
    pct = [int(m) for m in re.findall(r"Bootstrapped (\d+)%", adb("logcat", "-d", "-s", "TorAndroidIntegration", check=False))]
    return max(pct) if pct else -1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("apk")
    ap.add_argument("--out", default="android-artifacts")
    ap.add_argument("--tor", action="store_true", help="also connect to Tor and load a page")
    ap.add_argument("--package", default=PKG, help="package id (use org.torproject.torbrowser for an upstream control run)")
    ap.add_argument("--label", default=LABEL)
    a = ap.parse_args()
    globals()["PKG"] = a.package
    os.makedirs(a.out, exist_ok=True)
    adb("wait-for-device")
    adb("logcat", "-c", check=False)

    print("1. install")
    adb("install", "-r", "-g", a.apk, timeout=600)
    pkgs = adb("shell", "pm", "list", "packages")
    assert f"package:{PKG}" in pkgs, "Umbra package not installed"
    dump = adb("shell", "dumpsys", "package", PKG)
    print("   ", re.search(r"versionName=.*", dump).group(0))

    print("2. launch")
    adb("shell", "monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")
    for _ in range(30):
        time.sleep(2)
        if alive():
            break
    time.sleep(15)
    shot(a.out, "01-first-screen")
    x = ui(a.out, "01-first-screen")
    if not alive() or crashed():
        print(crashed() or "process not running")
        return 1
    print("   running, pid", adb("shell", "pidof", PKG).strip())

    print("3. label")
    badging = subprocess.run([find_aapt2(), "dump", "badging", a.apk], capture_output=True, text=True).stdout
    label = re.search(r"application-label:'([^']*)'", badging)
    print("   ", label and label.group(1))
    assert label and label.group(1) == a.label, f"launcher label is not {a.label}"

    if not a.tor:
        return 0
    print("4. connect to Tor")
    for i in range(6):
        x = ui(a.out, f"02-connect-{i}")
        print("   screen:", " | ".join(texts(x))[:300])
        if TOR_DEAD in x:
            print("   FAIL: the bundled tor process exited")
            save_tor_log(a.out)
            return 1
        hit = tap_text(x, ["Connect", "Got it", "Continue", "Not now", "Skip"])
        print("   tapped", hit)
        time.sleep(5)
        if hit == "Connect":
            break
    deadline = time.time() + 300
    connected = False
    while time.time() < deadline:
        time.sleep(10)
        x = ui(a.out, "03-bootstrap")
        t = " | ".join(texts(x))
        if TOR_DEAD in t:
            print("   FAIL: the bundled tor process exited")
            save_tor_log(a.out)
            return 1
        pct = bootstrap_progress()
        print(f"   bootstrap {pct}%")
        if pct == 100:
            connected = True
            time.sleep(10)
            break
    print("   last screen:", " | ".join(texts(ui(a.out, "03-bootstrap")))[:300])
    shot(a.out, "03-after-bootstrap")
    if not connected:
        print("   FAIL: tor did not reach Bootstrapped 100%")
        save_tor_log(a.out)
        return 1
    print("   connected: Bootstrapped 100%")
    tap_text(ui(a.out, "03-home"), ["Close"])  # dismiss the upstream donation card
    time.sleep(2)

    print("5. load check.torproject.org from the address bar")
    type_in_address_bar(a.out, "https://check.torproject.org/")
    t = wait_for_text(a.out, "04-check-torproject", "Congratulations")
    shot(a.out, "04-check-torproject")
    verified = bool(t)
    print("   ", "Congratulations. This browser is configured to use Tor." if verified else "page text not found (see screenshot)")

    print("6. search from the address bar (default engine)")
    type_in_address_bar(a.out, "tor project")
    t = wait_for_text(a.out, "05-search", "Clearnet", 90)  # OnionSearch result tabs: Onions | Clearnet | News
    shot(a.out, "05-search")
    searched = bool(t)
    print("   ", "results from onionsearch.io" if searched else "OnionSearch result page not detected (see screenshot)")
    verified = verified and searched
    if crashed() or not alive():
        print(crashed() or "process died")
        return 1
    save_tor_log(a.out)
    return 0 if verified else 2


if __name__ == "__main__":
    sys.exit(main())
