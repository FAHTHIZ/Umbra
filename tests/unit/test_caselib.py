"""Offline case tooling (tools/investigate): format parity with the browser and tamper detection."""
import json
import os
import shutil
import subprocess

import pytest

from tools.investigate import caselib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CORE = os.path.join(ROOT, "overlay", "investigate", "investigate-core.mjs")


def _js(code):
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, "--input-type=module", "-e", f"import * as C from {json.dumps('file://' + CORE)};\n{code}"],
                       capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


SAMPLE = {"b": [1, 2, {"z": None, "a": "ünïcødé \u2028 \"q\""}], "a": True, "n": -0.5, "big": 12345678901, "e": {}}


def test_canonical_json_matches_browser():
    js = _js(f"console.log(JSON.stringify(C.canonicalJson({json.dumps(SAMPLE)})));")
    assert caselib.canonical_json(SAMPLE) == js


def test_browser_chain_verifies_in_python_and_vice_versa():
    entries = _js("""
      let prev = null; const out = [];
      for (const [t, d] of [["case-created", {name: "x"}], ["artifact", {path: "artifacts/0001-dom.html", sha256: "ab"}], ["note", {text: "ü"}]]) {
        prev = await C.chainEntry(prev, t, d, "2026-01-01T00:00:00.000Z"); out.push(prev);
      }
      console.log(JSON.stringify(out));""")
    assert caselib.verify_chain(entries)["ok"] is True
    prev = None
    py = []
    for t, d in (("case-created", {"name": "x"}), ("artifact", {"path": "artifacts/0001-dom.html", "sha256": "ab"}), ("note", {"text": "ü"})):
        prev = caselib.chain_entry(prev, t, d, "2026-01-01T00:00:00.000Z")
        py.append(prev)
    assert py == entries
    assert _js(f"console.log(JSON.stringify(await C.verifyChain({json.dumps(py)})));")["ok"] is True


def test_chain_tampering_detected():
    prev, es = None, []
    for i in range(4):
        prev = caselib.chain_entry(prev, "note", {"i": i})
        es.append(prev)
    assert caselib.verify_chain(es)["ok"]
    bad = [dict(e) for e in es]
    bad[1]["data"] = {"i": 99}
    assert caselib.verify_chain(bad) == {"ok": False, "brokenAt": 1} or caselib.verify_chain(bad)["ok"] is False
    assert caselib.verify_chain(es[:1] + es[2:])["ok"] is False
    assert caselib.verify_chain(list(reversed(es)))["ok"] is False


def _make_case(tmp_path):
    d = tmp_path / "case-x"
    (d / "artifacts").mkdir(parents=True)
    (d / "manifest.json").write_text(json.dumps({"id": "case-x", "artifacts": []}))
    (d / "case-log.jsonl").write_text("")
    caselib.append_log(str(d), "case-created", {"name": "t"})
    caselib.add_artifact(str(d), "note", "txt", b"hello", {})
    return d


def test_add_artifact_and_verify(tmp_path):
    d = _make_case(tmp_path)
    res = caselib.verify_case(str(d))
    assert res["ok"], res
    man = caselib.load_manifest(str(d))
    assert man["artifacts"][0]["sha256"] == caselib.sha256_hex(b"hello")


def test_unlisted_and_missing_files_detected(tmp_path):
    d = _make_case(tmp_path)
    (d / "artifacts" / "sneaky.bin").write_bytes(b"x")
    probs = {p["problem"] for p in caselib.verify_case(str(d))["problems"]}
    assert "not-in-manifest" in probs
    os.remove(d / "artifacts" / "sneaky.bin")
    art = caselib.load_manifest(str(d))["artifacts"][0]
    os.remove(d / art["path"])
    probs = {p["problem"] for p in caselib.verify_case(str(d))["problems"]}
    assert "missing" in probs


def test_attach_cli(tmp_path):
    d = _make_case(tmp_path)
    f = tmp_path / "scan.json"
    f.write_text("{}")
    r = subprocess.run(["python3", "-m", "tools.investigate.attach", str(d), str(f), "--tool", "OnionScan", "--tool-version", "abc"],
                       cwd=ROOT, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert caselib.verify_case(str(d))["ok"]
    assert caselib.read_log(str(d))[-1]["data"] == {"tool": "OnionScan", "version": "abc",
                                                    "path": caselib.load_manifest(str(d))["artifacts"][-1]["path"],
                                                    "sha256": caselib.sha256_hex(b"{}")}
