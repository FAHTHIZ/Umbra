# Umbra Explore

A curated onion directory on the home page. Rules for inclusion (enforced in review and CI):
1. The address must be published **by the operator itself**, on its clearnet site or official channel. Link the source in the PR.
2. It must be a v3 address with a valid checksum and version byte. `tests/unit/test_onions.py` checks this.
3. No marketplaces, no unverifiable "hidden wiki" lists, nothing illegal.

Data: `overlay/explore/curated-onions.json` → `python tools/gen_explore.py` → `overlay/home/umbraExplore.js` (static; no network).
