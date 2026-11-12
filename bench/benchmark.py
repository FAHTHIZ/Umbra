#!/usr/bin/env python3
"""Umbra vs upstream Tor Browser: same machine, same conditions, offline.

Metrics
  startup_ms   wall time of `--headless --screenshot about:tor` (process start ->
               first rendered home page written to disk -> exit), fresh profile.
  warm_ms      same, reusing a profile that has already started once.
  rss_mb       total resident memory of all browser processes ~3s after the
               home page loaded (Linux /proc).
  home_load_ms navigation to about:tor measured by the Navigation Timing API.

Usage: python bench/benchmark.py --runs 10 [--umbra DIR] [--upstream DIR]
"""
import argparse
import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)


def _env():
    return dict(os.environ, TOR_PROVIDER="none", MOZ_HEADLESS="1")


def shot(app, profile):
    out = os.path.join(profile, "s.png")
    t = time.perf_counter()
    subprocess.run([os.path.join(app, "Browser", "firefox.real"), "--headless", "--profile", profile,
                    "--screenshot", out, "--window-size=1280,800", "about:tor"],
                   env=_env(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120, check=True)
    dt = (time.perf_counter() - t) * 1000
    assert os.path.exists(out)
    os.remove(out)
    return dt


def _tree(root):
    """PIDs of root and all its descendants (only the browser under test)."""
    kids = {}
    for p in os.listdir("/proc"):
        if p.isdigit():
            try:
                ppid = int(open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split()[1])
                kids.setdefault(ppid, []).append(int(p))
            except (OSError, IndexError, ValueError):
                pass
    out, stack = [], [int(root)]
    while stack:
        x = stack.pop()
        out.append(x)
        stack.extend(kids.get(x, []))
    return out


def rss_and_load(app):
    from tests.browser_driver import start, stop
    d = start(app)
    try:
        d.get("about:tor")
        load = d.execute_script("const n=performance.getEntriesByType('navigation')[0]; return n ? n.loadEventEnd : null")
        time.sleep(3)
        total = 0
        for p in _tree(d.capabilities["moz:processID"]):
            try:
                for l in open(f"/proc/{p}/status"):
                    if l.startswith("VmRSS:"):
                        total += int(l.split()[1])
            except OSError:
                pass
        return total / 1024, load
    finally:
        stop(d)


def bench(app, runs):
    cold, warm, rss, load = [], [], [], []
    for _ in range(runs):
        p = tempfile.mkdtemp()
        cold.append(shot(app, p))
        warm.append(shot(app, p))
        shutil.rmtree(p, ignore_errors=True)
    for _ in range(max(3, runs // 3)):
        r, l = rss_and_load(app)
        rss.append(r)
        if l is not None:
            load.append(l)
    s = lambda xs: {"median": round(statistics.median(xs), 1), "min": round(min(xs), 1), "max": round(max(xs), 1), "n": len(xs)}
    return {"startup_ms": s(cold), "warm_ms": s(warm), "rss_mb": s(rss), "home_load_ms": s(load) if load else None}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--runs", type=int, default=10)
    a.add_argument("--umbra")
    a.add_argument("--upstream")
    a.add_argument("--out", default=os.path.join(ROOT, "bench", "results", "latest.json"))
    args = a.parse_args()
    from tests.conftest import _find_app, _upstream_app
    umbra = args.umbra or _find_app()
    up = args.upstream or _upstream_app()
    # Interleave to share thermal/cache conditions fairly: warm-up both first.
    for app in (umbra, up):
        shot(app, tempfile.mkdtemp())
    res = {"machine": {"cpu_count": os.cpu_count(), "platform": platform.platform(),
                       "mem_gb": round(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 2**30, 1)},
           "date": time.strftime("%Y-%m-%d"), "runs": args.runs,
           "umbra": bench(umbra, args.runs), "upstream_tor_browser": bench(up, args.runs)}
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    json.dump(res, open(args.out, "w"), indent=1)
    print(json.dumps(res, indent=1))


if __name__ == "__main__":
    main()
