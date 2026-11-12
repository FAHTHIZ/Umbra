#!/usr/bin/env python3
"""Offline analysis of a case with pinned upstream tools; results are attached as new artifacts.

    python3 -m tools.investigate.analyze_case CASE_DIR [--no-exiftool] [--no-har]

 - exiftool -json -G on every screenshot/attachment (metadata report)
 - mitmproxy's own HAR reader on every *.har artifact (flow summary)
 - verification (hashes, chain) before and after

Needs no network; in the toolkit it runs in a container with network_mode: none.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tools.investigate import caselib  # noqa: E402


def tool_version(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30).stdout.strip().splitlines()[0]
    except Exception:
        return "unknown"


def exif_report(case_dir, arts):
    exe = shutil.which("exiftool")
    if not exe:
        return None
    paths = [os.path.join(case_dir, *a["path"].split("/")) for a in arts
             if a["path"].rsplit(".", 1)[-1] in ("png", "jpg", "jpeg", "gif", "webp", "pdf", "bin", "tif", "tiff")
             or a["kind"].startswith("ext-")]
    if not paths:
        return None
    r = subprocess.run([exe, "-json", "-G", "-n", *paths], capture_output=True, text=True)
    data = json.loads(r.stdout or "[]")
    for d in data:
        d["SourceFile"] = os.path.relpath(d.get("SourceFile", ""), case_dir).replace(os.sep, "/")
    return {"tool": "exiftool", "version": tool_version([exe, "-ver"]), "results": data}


def har_report(case_dir, arts):
    try:
        from mitmproxy import io as mio
        from mitmproxy.version import VERSION
    except Exception:
        return None
    out = []
    for a in arts:
        if not a["path"].endswith(".har"):
            continue
        p = os.path.join(case_dir, *a["path"].split("/"))
        flows = list(mio.read_flows_from_paths([p]))
        out.append({"artifact": a["path"], "sha256": a["sha256"], "flows": len(flows),
                    "hosts": sorted({f.request.pretty_host for f in flows if hasattr(f, "request")}),
                    "statuses": sorted({f.response.status_code for f in flows if getattr(f, "response", None)})})
    return {"tool": "mitmproxy", "version": VERSION, "results": out} if out else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("case_dir")
    ap.add_argument("--no-exiftool", action="store_true")
    ap.add_argument("--no-har", action="store_true")
    a = ap.parse_args(argv)
    before = caselib.verify_case(a.case_dir)
    if not before["ok"]:
        print("case does not verify; refusing to add analysis:", json.dumps(before["problems"])[:500], file=sys.stderr)
        return 1
    arts = caselib.load_manifest(a.case_dir)["artifacts"]
    added = []
    for enabled, fn, kind in ((not a.no_exiftool, exif_report, "analysis-exiftool"), (not a.no_har, har_report, "analysis-har")):
        if not enabled:
            continue
        rep = fn(a.case_dir, arts)
        if rep is None:
            print(f"{kind}: skipped (tool not available or nothing to analyse)")
            continue
        art = caselib.add_artifact(a.case_dir, kind, "json", (json.dumps(rep, indent=2) + "\n").encode(),
                                   {"tool": rep["tool"], "toolVersion": rep["version"]})
        caselib.append_log(a.case_dir, "external-tool", {"tool": rep["tool"], "version": rep["version"], "path": art["path"],
                                                         "sha256": art["sha256"]})
        added.append(art["path"])
        print(f"{kind}: {art['path']} ({rep['tool']} {rep['version']})")
    after = caselib.verify_case(a.case_dir)
    print("VERIFIED" if after["ok"] else "FAILED", f"{after['artifacts']} artifacts")
    return 0 if after["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
