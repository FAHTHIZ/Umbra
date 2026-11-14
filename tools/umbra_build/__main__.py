import argparse
import json
import sys

from . import UMBRA_VERSION
from .build import build, fetch


def main(argv=None):
    p = argparse.ArgumentParser(prog="umbra_build", description=f"Umbra {UMBRA_VERSION} build tool")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="verify upstream and build Umbra")
    b.add_argument("--platform", default="linux-x86_64",
                   help="linux-x86_64, linux-aarch64, windows-x86_64, android-aarch64, android-armv7, android-x86_64")
    b.add_argument("--cache")
    b.add_argument("--out")
    b.add_argument("--no-package", action="store_true")
    f = sub.add_parser("fetch", help="download + verify upstream only")
    f.add_argument("--platform", default="linux-x86_64")
    f.add_argument("--cache")
    sub.add_parser("upstream-check", help="report whether a newer Tor Browser release exists")
    a = p.parse_args(argv)
    if a.cmd == "build" and a.platform.startswith("android-"):
        from .android import build_android
        r = build_android(a.platform, a.cache, a.out)
        print(json.dumps({k: v for k, v in r.items() if k != "changes"}, indent=1))
    elif a.cmd == "build":
        r = build(a.platform, a.cache, a.out, not a.no_package)
        print(json.dumps({k: v for k, v in r.items() if k != "changes"}, indent=1))
    elif a.cmd == "fetch":
        print(fetch(a.platform, a.cache))
    elif a.cmd == "upstream-check":
        from .upstream import check
        r = check()
        print(json.dumps(r, indent=1))
        sys.exit(10 if r["update_available"] else 0)


if __name__ == "__main__":
    main()
