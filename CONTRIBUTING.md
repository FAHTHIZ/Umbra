# Contributing to Umbra

Thank you for helping. Umbra protects people who may be at real risk, so the bar for correctness is high, and the process is meant to be simple.

## Quick start

```bash
git clone https://github.com/FAHTHIZ/Umbra && cd Umbra
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest tests/unit                 # < 1 s
python -m tools.umbra_build build           # builds dist/umbra-*/
# geckodriver on PATH for the rest:
python -m pytest tests/integration tests/leak
```

## Where things live

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#repository-layout). Most contributions touch `overlay/`:

| You want to… | Edit | Then |
|---|---|---|
| Add or modify a search provider | `overlay/search/umbra-search-engines.json` (+ `overlay/home/aboutTor.js` list) | `pytest tests/unit/test_search_config.py` |
| Add an onion site to Explore | `overlay/explore/curated-onions.json`, with a link to the operator's own announcement in the PR | `python tools/gen_explore.py && pytest tests/unit/test_onions.py` |
| Change the home page | `overlay/home/*` (CSP: `default-src chrome:`, no inline scripts, no remote resources) | rebuild, screenshot, `pytest tests/integration` |
| Change a preference | `overlay/prefs/umbra-prefs.js` | `pytest tests/unit/test_prefs_policy.py tests/integration/test_parity.py` |
| Patch upstream JS | `overlay/patches/patches.json` (anchored find/replace) | rebuild; the build fails if the anchor drifts |

## Adding a module

See [docs/MODULE_GUIDE.md](docs/MODULE_GUIDE.md) for the file layout, startup hook, ESR 153 gotchas and the required tests.

## The rules

1. **Fingerprint parity.** Don't change anything a website can observe: prefs in the denylisted namespaces, fonts, enabled web APIs, window sizing. `tests/integration/test_parity.py` must stay green. If you think an exception is justified, open an entry in [docs/IDEAS.md](docs/IDEAS.md) first.
2. **No network from Umbra UI.** Umbra pages are local only.
3. **No unverified claims.** Mark a feature ✅ in `docs/CHECKLIST.md` only with a test or a recorded measurement.
4. **Never weaken Tor or browser security for performance.**
5. **Keep upstream pristine.** Prefer configuration over patches, and keep patches tiny and anchored.

## Commits and PRs

- Use small, focused commits with a clear subject ("Add Mojeek provider", not "updates").
- Every PR must say: what changed, how it was tested, and whether it can affect fingerprinting.
- CI must be green. The `live-tor` job is informational, because Tor reachability varies.

## Proposing ideas

Open a "Feature idea" issue. Engineering evaluates feasibility, architecture, security and performance in `docs/IDEAS.md`. The project owner decides product direction.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
