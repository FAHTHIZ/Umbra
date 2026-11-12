"""toolkit/upstreams.lock.json: every requested investigation upstream is pinned and accounted for."""
import configparser
import glob
import json
import os
import subprocess

from toolkit.fetch_upstreams import LOCK, check, load

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The exact list the project owner asked to evaluate. Each must be pinned or explained.
REQUESTED = [
    "https://github.com/torproject/tor", "https://gitlab.torproject.org/tpo/applications/tor-browser",
    "https://github.com/DedSecInside/TorBot", "https://github.com/nao1215/onionscan",
    "https://github.com/h0ek/onionscout", "https://github.com/megadose/OnionSearch",
    "https://github.com/ahmia/ahmia", "https://github.com/ail-project/ail-framework",
    "https://github.com/josh0xA/darkdump", "https://github.com/N0rz3/DarkSpider",
    "https://github.com/mitmproxy/mitmproxy", "https://github.com/zaproxy/zaproxy",
    "https://github.com/OWASP/www-project-penetration-testing-kit", "https://github.com/google/timesketch",
    "https://github.com/log2timeline/plaso", "https://github.com/sleuthkit/autopsy",
    "https://github.com/sleuthkit/sleuthkit", "https://github.com/exiftool/exiftool",
    "https://github.com/jessek/hashdeep",
]


def test_lock_is_valid():
    assert check(load()) == []


def test_no_forks_claimed_without_entries():
    lock = load()
    assert lock["forks"] == [] and lock["fork_policy"]


def test_every_requested_project_is_accounted_for():
    lock = load()
    blob = json.dumps(lock).lower()
    pinned = {u["url"].lower().removesuffix(".git") for u in lock["upstreams"]}
    for url in REQUESTED:
        u = url.lower()
        assert u in pinned or u.split("//", 1)[1] in blob, f"{url} neither pinned nor explained"


def test_torbot_submodule_matches_lock():
    out = subprocess.run(["git", "ls-tree", "HEAD", "vendor/torbot"], cwd=ROOT, capture_output=True, text=True).stdout
    sha = out.split()[2]
    torbot = next(u for u in load()["upstreams"] if u["name"] == "torbot")
    assert sha == torbot["commit"]


def test_tor_browser_pin_matches_built_bundle():
    inis = glob.glob(os.path.join(ROOT, "dist", "umbra-*", "umbra", "Browser", "platform.ini"))
    if not inis:
        import pytest
        pytest.skip("no built bundle")
    cp = configparser.ConfigParser()
    cp.read(inis[0])
    tb = next(u for u in load()["upstreams"] if u["name"] == "tor-browser")
    assert cp["Build"]["SourceStamp"] == tb["commit"]
