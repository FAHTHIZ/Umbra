#!/usr/bin/env python3
"""Verify an Umbra Investigate case offline.

    python3 -m tools.investigate.verify_case CASE_DIR [--hashdeep]
    python3 -m tools.investigate.verify_case --bundle CASE.umbracase --extract-to DIR

Checks: every artifact's SHA-256 and size against manifest.json, every artifact is
recorded in the hash-chained case-log.jsonl, the chain itself is intact, no unlisted
files in artifacts/. With --hashdeep, also runs the real `hashdeep` audit against
hashdeep.txt. Bundles are decrypted with the passphrase from $UMBRA_CASE_PASSPHRASE
or an interactive prompt (needs the `cryptography` package). Exit code 0 = verified.
"""
import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from tools.investigate import caselib  # noqa: E402


def hashdeep_audit(case_dir):
    exe = shutil.which("hashdeep")
    if not exe:
        return {"ran": False, "reason": "hashdeep not installed"}
    r = subprocess.run([exe, "-c", "sha256", "-a", "-k", os.path.join("..", "hashdeep.txt"), "-l", "-r", "."],
                       cwd=os.path.join(case_dir, "artifacts"), capture_output=True, text=True)
    return {"ran": True, "passed": r.returncode == 0, "output": (r.stdout + r.stderr).strip()}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("case_dir", nargs="?")
    ap.add_argument("--hashdeep", action="store_true", help="also run the real hashdeep audit")
    ap.add_argument("--bundle", help="decrypt an encrypted .umbracase bundle first")
    ap.add_argument("--extract-to", help="directory to extract the bundle into")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    case_dir = a.case_dir
    if a.bundle:
        if not a.extract_to:
            ap.error("--bundle needs --extract-to")
        pw = os.environ.get("UMBRA_CASE_PASSPHRASE") or getpass.getpass("Case passphrase: ")
        case_dir = caselib.extract_bundle(caselib.decrypt_bundle(a.bundle, pw), a.extract_to)
    if not case_dir:
        ap.error("give CASE_DIR or --bundle")
    res = caselib.verify_case(case_dir)
    res["case"] = case_dir
    if a.hashdeep:
        res["hashdeep"] = hashdeep_audit(case_dir)
        if res["hashdeep"].get("ran") and not res["hashdeep"]["passed"]:
            res["ok"] = False
    if a.json:
        print(json.dumps(res, indent=2))
    else:
        print(("VERIFIED" if res["ok"] else "FAILED") + f": {res['artifacts']} artifacts, {res['logEntries']} log entries, "
              f"chain {'intact' if res['chain']['ok'] else 'BROKEN at ' + str(res['chain']['brokenAt'])}")
        for p in res["problems"]:
            print(f"  {p['problem']}: {p['path']}")
        if "hashdeep" in res:
            print("  hashdeep: " + (res["hashdeep"].get("output") or res["hashdeep"].get("reason", "")))
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
