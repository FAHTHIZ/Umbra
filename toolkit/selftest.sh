#!/usr/bin/env bash
# Toolkit self-test (run in CI; needs Docker with compose v2). Proves the isolation claims in
# toolkit/README.md instead of assuming them. Set UMBRA_TOOLKIT_LIVE=1 to also bootstrap Tor and
# check that the SOCKS port is onion-only (needs internet for Tor itself).
set -euo pipefail
cd "$(dirname "$0")"
DC="docker compose -f compose.yaml --profile tools"
fail() { echo "SELFTEST FAIL: $*" >&2; exit 1; }

$DC config -q
$DC build tor analysis onionsearch

echo "== a tool container has no direct route to the internet"
if $DC run --rm --no-deps --entrypoint python3 onionsearch -c \
  "import socket; socket.create_connection(('1.1.1.1', 443), 5)" 2>/dev/null; then
  fail "tool container reached 1.1.1.1 directly"
fi
if $DC run --rm --no-deps --entrypoint python3 onionsearch -c \
  "import socket; socket.getaddrinfo('example.com', 443)" 2>/dev/null; then
  fail "tool container resolved a public name"
fi

echo "== the analysis container has no network at all"
$DC run --rm --entrypoint python3 analysis -c \
  "import socket,sys
try:
    socket.create_connection(('1.1.1.1', 443), 5)
except OSError:
    sys.exit(0)
sys.exit(1)" || fail "analysis container has network access"

echo "== offline verification with pinned exiftool/hashdeep/mitmproxy"
rm -rf cases && mkdir -p cases && chmod 0777 cases
python3 - <<'PY'
import json, os, sys
sys.path.insert(0, "..")
from tools.investigate import caselib
d = os.path.join("cases", "case-selftest")
os.makedirs(os.path.join(d, "artifacts"))
json.dump({"id": "case-selftest", "artifacts": []}, open(os.path.join(d, "manifest.json"), "w"))
open(os.path.join(d, "case-log.jsonl"), "w").close()
caselib.append_log(d, "case-created", {"name": "selftest"})
png = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c63000100000500010d0a2db40000000049454e44ae426082")
caselib.add_artifact(d, "screenshot", "png", png, {})
har = {"log": {"version": "1.2", "creator": {"name": "selftest", "version": "1"}, "entries": [{
    "startedDateTime": "2026-01-01T00:00:00.000Z", "time": 1,
    "request": {"method": "GET", "url": "http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/",
                "httpVersion": "HTTP/1.1", "headers": [], "queryString": [], "cookies": [], "headersSize": -1, "bodySize": 0},
    "response": {"status": 200, "statusText": "OK", "httpVersion": "HTTP/1.1", "headers": [], "cookies": [],
                 "content": {"size": 0, "mimeType": "text/html"}, "redirectURL": "", "headersSize": -1, "bodySize": 0},
    "cache": {}, "timings": {"send": 0, "wait": 1, "receive": 0}}]}}
caselib.add_artifact(d, "traffic", "har", json.dumps(har).encode(), {})
man = caselib.load_manifest(d)
with open(os.path.join(d, "hashdeep.txt"), "w") as f:
    f.write("%%%% HASHDEEP-1.0\n%%%% size,sha256,filename\n")
    for a in man["artifacts"]:
        f.write(f"{a['size']},{a['sha256']},./{a['path'].split('/', 1)[1]}\n")
os.system(f"chmod -R a+rwX {d}")
PY
$DC run --rm analysis tools.investigate.verify_case /cases/case-selftest --hashdeep | tee /tmp/verify.txt
grep -q "^VERIFIED" /tmp/verify.txt || fail "verify_case"
grep -q "Audit passed" /tmp/verify.txt || fail "hashdeep audit"
$DC run --rm analysis tools.investigate.analyze_case /cases/case-selftest | tee /tmp/analyze.txt
grep -q "analysis-exiftool" /tmp/analyze.txt || fail "exiftool analysis"
grep -q "analysis-har" /tmp/analyze.txt || fail "mitmproxy HAR analysis"
grep -q "^VERIFIED" /tmp/analyze.txt || fail "case does not verify after analysis"

if [ "${UMBRA_TOOLKIT_LIVE:-0}" = "1" ]; then
  echo "== live: Tor bootstraps and its SOCKS port refuses clearnet"
  $DC up -d --wait --wait-timeout 300 tor || { $DC logs tor; fail "tor did not bootstrap"; }
  $DC run --rm --entrypoint sh onionsearch -c 'umbra-forward python3 - <<PY
import socks, sys, time
time.sleep(1)
s = socks.socksocket(); s.set_proxy(socks.SOCKS5, "127.0.0.1", 9050, rdns=True); s.settimeout(60)
try:
    s.connect(("example.com", 80)); print("CLEARNET REACHABLE"); sys.exit(1)
except Exception as e:
    print("clearnet refused by tor:", type(e).__name__, e)
PY' || fail "Tor SOCKS port allowed a clearnet destination"
  $DC run --rm --entrypoint sh onionsearch -c 'umbra-forward python3 - <<PY
import socks, time
time.sleep(1)
s = socks.socksocket(); s.set_proxy(socks.SOCKS5, "127.0.0.1", 9050, rdns=True); s.settimeout(120)
try:
    s.connect(("duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion", 80)); print("onion reachable")
except Exception as e:
    print("WARNING: onion not reachable (network conditions):", e)
PY'
  $DC down
fi
echo "SELFTEST OK"
