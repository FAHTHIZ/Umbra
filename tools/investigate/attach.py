#!/usr/bin/env python3
"""Attach output of an external tool (onionscan, onionscout, TorBot, ZAP, ...) to a case.

    python3 -m tools.investigate.attach CASE_DIR report.json --tool onionscan --tool-version <commit>

The file is copied into artifacts/ (write-once), hashed, added to manifest.json and
recorded in the hash-chained log together with the tool name and pinned version.
Run tools only against services you operate or are authorised to assess.
"""
import argparse
import os
import re
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tools.investigate import caselib  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("case_dir")
    ap.add_argument("file")
    ap.add_argument("--tool", required=True)
    ap.add_argument("--tool-version", default="unknown")
    ap.add_argument("--url", default=None, help="onion URL the output refers to")
    a = ap.parse_args(argv)
    ext = os.path.splitext(a.file)[1].lstrip(".").lower() or "bin"
    if not re.fullmatch(r"[a-z0-9]+", ext):
        ext = "bin"
    tool = re.sub(r"[^a-z0-9-]+", "-", a.tool.lower()).strip("-") or "tool"
    with open(a.file, "rb") as f:
        data = f.read()
    art = caselib.add_artifact(a.case_dir, "ext-" + tool, ext, data,
                               {"url": a.url, "tool": a.tool, "toolVersion": a.tool_version, "sourceName": os.path.basename(a.file)})
    caselib.append_log(a.case_dir, "external-tool", {"tool": a.tool, "version": a.tool_version, "path": art["path"],
                                                     "sha256": art["sha256"]})
    print(f"attached {art['path']} sha256={art['sha256']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
