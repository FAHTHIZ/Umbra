# Performance

## Principle

Umbra never trades away Tor or browser security for speed. Every optimization must keep the fingerprint-parity and leak tests green.

## Measured results

Run `python bench/benchmark.py --runs 10`. The script measures Umbra and unmodified upstream Tor Browser on the same machine, back to back, offline (`TOR_PROVIDER=none`), with fresh profiles.

**2026-11-12 · Linux x86-64 · 2 vCPU · 7.8 GB RAM · Tor Browser 16.0.1** ([raw JSON](../bench/results/2026-11-12-linux-x86_64-2cpu.json))

| Metric (median, n) | Umbra 0.1.0 | Upstream Tor Browser | Difference |
|---|---|---|---|
| Cold start → home page rendered (ms, 10) | 816.9 | 817.1 | none (same engine) |
| Warm start (ms, 10) | 515.4 | 565.0 | within measurement granularity (~50 ms steps) |
| Total RSS, home page open (MB, 3) | 730.7 | 737.0 | about −1% |
| Home page load event (ms, 3) | **44** | 99 | **about 2× faster**: lighter page, no campaign banner or extra web components |

Honest reading: v0.1 is **as fast as Tor Browser** at the engine level. The engine binary is identical, so a large startup gain isn't possible on the overlay track. The measurable win is the lighter home page. The real gains are planned below, and each will be measured before it's claimed.

## Optimizations shipped

- Lightweight home page: one CSS file, one small script, local SVGs, no web components, no remote resources.
- `browser.sessionstore.restore_on_demand` and pinned-tab on-demand restore: restored sessions don't load every tab at startup.
- `browser.tabs.unloadOnLowMemory`: background tabs are unloaded under memory pressure.

## Candidates (must be measured and parity-checked first)

| Idea | Expected effect | Fingerprint risk | Status |
|---|---|---|---|
| Hardware tiers: fewer content processes on ≤4 GB RAM (`dom.ipc.processCount`) | Lower RSS on low-end devices | Not web-observable, but parity must be checked | 📋 |
| Tab unloading on a timer (idle tabs) | Lower RSS and CPU | None | 📋 |
| Cache size tuning (memory cache only, as upstream) | — | Upstream sets these for privacy; **don't touch** | ✗ |
| Disabling animations | Small CPU gain | Could be observable via `prefers-reduced-motion` | ✗ |
| Source-track PGO/LTO builds | Real startup and page-load gains | None | 📋 v1.0 |
| Android battery: background tab throttling | Battery | None | 📋 v1.0 |
