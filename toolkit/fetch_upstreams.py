#!/usr/bin/env python3
"""Fetch pinned investigation upstreams at their exact commits and verify them.

    python3 toolkit/fetch_upstreams.py                 # all, into toolkit/.upstreams/
    python3 toolkit/fetch_upstreams.py --only mitmproxy hashdeep
    python3 toolkit/fetch_upstreams.py --check         # validate the lock file only (offline)

Each repository is fetched with `git fetch --depth 1 origin <sha>` (no branch
names are trusted), then `git rev-parse HEAD` must equal the pinned SHA and the
tree must contain a license/copying file. Nothing is built or executed here.
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCK = os.path.join(HERE, "upstreams.lock.json")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
LEVELS = {
    "integrated-foundation", "integrated-via-tor-browser", "integrated-search-endpoint",
    "integrated-har-interop", "integrated-export-format", "integrated-offline-analysis",
    "integrated-manifest-format", "submodule+standalone-container+leads-import",
    "standalone-container", "standalone-container+leads-import", "standalone-external",
    "standalone-reference", "unresolved-candidate",
}
LICENSE_NAMES = ("license", "licence", "copying", "license.md", "license.txt", "licence.md",
                 "license-2.0.txt", "copying.txt", "licenses")


def load(path=LOCK):
    with open(path) as f:
        return json.load(f)


def check(lock):
    errors = []
    seen = set()
    for u in lock["upstreams"]:
        n = u.get("name", "?")
        for k in ("name", "url", "commit", "license", "integration", "how"):
            if not u.get(k):
                errors.append(f"{n}: missing {k}")
        if n in seen:
            errors.append(f"{n}: duplicate")
        seen.add(n)
        if not SHA_RE.match(u.get("commit", "")):
            errors.append(f"{n}: commit is not a full 40-hex SHA")
        if not u.get("url", "").startswith("https://"):
            errors.append(f"{n}: url must be https")
        if u.get("integration") not in LEVELS:
            errors.append(f"{n}: unknown integration level {u.get('integration')}")
    return errors


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def fetch(u, dest):
    path = os.path.join(dest, u["name"])
    os.makedirs(path, exist_ok=True)
    if not os.path.isdir(os.path.join(path, ".git")):
        git("init", "-q", cwd=path)
        git("remote", "add", "origin", u["url"], cwd=path)
    git("fetch", "-q", "--depth", "1", "origin", u["commit"], cwd=path)
    git("-c", "advice.detachedHead=false", "checkout", "-q", "--force", "FETCH_HEAD", cwd=path)
    head = git("rev-parse", "HEAD", cwd=path)
    if head != u["commit"]:
        raise RuntimeError(f"{u['name']}: HEAD {head} != pinned {u['commit']}")
    names = {x.lower() for x in os.listdir(path)}
    if not any(x in names for x in LICENSE_NAMES) and "README" not in os.listdir(path):
        raise RuntimeError(f"{u['name']}: no license file at the pinned commit")
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--dest", default=os.path.join(HERE, ".upstreams"))
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    lock = load()
    errs = check(lock)
    if errs:
        print("\n".join(errs), file=sys.stderr)
        return 1
    if a.check:
        print(f"lock OK: {len(lock['upstreams'])} upstreams")
        return 0
    want = set(a.only or [u["name"] for u in lock["upstreams"]])
    unknown = want - {u["name"] for u in lock["upstreams"]}
    if unknown:
        print(f"unknown: {sorted(unknown)}", file=sys.stderr)
        return 1
    for u in lock["upstreams"]:
        if u["name"] in want:
            p = fetch(u, a.dest)
            print(f"{u['name']}: {u['commit']} OK -> {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
