"""Python side of the Umbra Investigate case format (mirrors overlay/investigate/investigate-core.mjs).

Used by verify_case.py, attach.py and analyze_case.py. Standard library only, except
bundle decryption, which needs the `cryptography` package (AES-GCM).
"""
import base64
import hashlib
import json
import os
import re
from datetime import datetime, timezone

GENESIS = "0" * 64
CASE_ID_RE = re.compile(r"^case-\d{8}-\d{6}-[a-z2-9]{6}$")


def canonical_json(v):
    """Same bytes as canonicalJson() in investigate-core.mjs (sorted keys, no spaces)."""
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonical_json(v[k])
                              for k in sorted(v)) + "}"
    if isinstance(v, list):
        return "[" + ",".join(canonical_json(x) for x in v) + "]"
    if isinstance(v, bool) or v is None:
        return json.dumps(v)
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return json.dumps(v, ensure_ascii=False)


def sha256_hex(data):
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_log(case_dir):
    p = os.path.join(case_dir, "case-log.jsonl")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def verify_chain(entries):
    prev = None
    for e in entries:
        if e.get("prev") != (prev["hash"] if prev else GENESIS):
            return {"ok": False, "brokenAt": e.get("seq"), "problem": "prev-mismatch"}
        if e.get("seq") != (prev["seq"] + 1 if prev else 1):
            return {"ok": False, "brokenAt": e.get("seq"), "problem": "seq-gap"}
        body = {k: v for k, v in e.items() if k != "hash"}
        if sha256_hex(canonical_json(body)) != e.get("hash"):
            return {"ok": False, "brokenAt": e.get("seq"), "problem": "hash-mismatch"}
        prev = e
    return {"ok": True, "count": len(entries), "brokenAt": None, "problem": None}


def chain_entry(prev, type_, data, time=None):
    body = {"seq": prev["seq"] + 1 if prev else 1, "time": time or now_iso(), "type": type_, "data": data,
            "prev": prev["hash"] if prev else GENESIS}
    return {**body, "hash": sha256_hex(canonical_json(body))}


def load_manifest(case_dir):
    with open(os.path.join(case_dir, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


def _write_private(path, data, mode="wb"):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, mode) as f:
        f.write(data)


def verify_case(case_dir):
    """Recompute every artifact SHA-256, check the hash chain and that every artifact is logged."""
    problems = []
    man = load_manifest(case_dir)
    for a in man["artifacts"]:
        p = os.path.join(case_dir, *a["path"].split("/"))
        if not os.path.isfile(p):
            problems.append({"path": a["path"], "problem": "missing"})
        elif sha256_file(p) != a["sha256"]:
            problems.append({"path": a["path"], "problem": "hash-mismatch"})
        elif os.path.getsize(p) != a["size"]:
            problems.append({"path": a["path"], "problem": "size-mismatch"})
    log = read_log(case_dir)
    chain = verify_chain(log)
    logged = {(e["data"].get("path"), e["data"].get("sha256")) for e in log if e.get("type") == "artifact"}
    for a in man["artifacts"]:
        if (a["path"], a["sha256"]) not in logged:
            problems.append({"path": a["path"], "problem": "not-in-log"})
    on_disk = set()
    art = os.path.join(case_dir, "artifacts")
    if os.path.isdir(art):
        on_disk = {"artifacts/" + n for n in os.listdir(art) if not n.endswith(".tmp")}
    for extra in sorted(on_disk - {a["path"] for a in man["artifacts"]}):
        problems.append({"path": extra, "problem": "not-in-manifest"})
    return {"ok": not problems and chain["ok"], "artifacts": len(man["artifacts"]), "logEntries": len(log),
            "chain": chain, "problems": problems}


def add_artifact(case_dir, kind, ext, data, meta=None):
    """Append an artifact from an external tool (same rules as the browser: write once, hash, log)."""
    if not re.fullmatch(r"[a-z0-9-]+", kind) or not re.fullmatch(r"[a-z0-9]+", ext):
        raise ValueError("bad artifact kind/extension")
    man = load_manifest(case_dir)
    n = max([a.get("capture", 0) for a in man["artifacts"]] or [0]) + 1
    name = f"{n:04d}-{kind}.{ext}"
    path = os.path.join(case_dir, "artifacts", name)
    if os.path.exists(path):
        raise FileExistsError(path)
    _write_private(path, data)
    a = {"path": "artifacts/" + name, "size": len(data), "sha256": sha256_hex(data), "kind": kind, "capture": n,
         "captured": now_iso(), **(meta or {})}
    man["artifacts"].append(a)
    man["updated"] = now_iso()
    _write_private(os.path.join(case_dir, "manifest.json"), (json.dumps(man, indent=2) + "\n").encode())
    append_log(case_dir, "artifact", {"kind": kind, "path": a["path"], "sha256": a["sha256"], "size": a["size"],
                                      "url": (meta or {}).get("url")})
    return a


def append_log(case_dir, type_, data):
    log = read_log(case_dir)
    e = chain_entry(log[-1] if log else None, type_, data)
    with open(os.path.join(case_dir, "case-log.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(e, ensure_ascii=False, separators=(",", ":")) + "\n")
    return e


def decrypt_bundle(path, passphrase):
    """Decrypt <case>.umbracase (Umbra Vault v1: PBKDF2-SHA256 + AES-256-GCM, header as AAD)."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # optional dependency

    with open(path, encoding="utf-8") as f:
        h = json.load(f)
    if h.get("format") != "umbra-vault" or h.get("version") != 1:
        raise ValueError("not an Umbra Vault file")
    k = h["kdf"]
    if k["name"] != "PBKDF2" or k["hash"] != "SHA-256" or h["cipher"]["name"] != "AES-GCM":
        raise ValueError("unsupported parameters")
    if not (100000 <= k["iterations"] <= 10000000):
        raise ValueError("unsupported iteration count")
    import unicodedata
    key = hashlib.pbkdf2_hmac("sha256", unicodedata.normalize("NFC", passphrase).encode(), base64.b64decode(k["salt"]),
                              k["iterations"], 32)
    aad = json.dumps([h["format"], h["version"], k["name"], k["hash"], k["iterations"], k["salt"], h["cipher"]["name"],
                      h["cipher"]["iv"]], separators=(",", ":")).encode()
    pt = AESGCM(key).decrypt(base64.b64decode(h["cipher"]["iv"]), base64.b64decode(h["ciphertext"]), aad)
    payload = json.loads(pt)
    if payload.get("kind") != "umbra-case-bundle":
        raise ValueError("not an Umbra case bundle")
    return payload


def extract_bundle(payload, dest_root):
    cid = payload["id"]
    if not CASE_ID_RE.match(cid):
        raise ValueError("bad case id")
    dest = os.path.join(dest_root, cid)
    os.makedirs(dest, mode=0o700)
    for rel, b64 in payload["files"].items():
        parts = rel.split("/")
        if any(p in ("", "..") or p.startswith(".") for p in parts):
            raise ValueError("unsafe path in bundle: " + rel)
        os.makedirs(os.path.join(dest, *parts[:-1]), mode=0o700, exist_ok=True)
        _write_private(os.path.join(dest, *parts), base64.b64decode(b64))
    return dest
