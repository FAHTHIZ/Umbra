# Idea intake

Every new idea from the product owner or a contributor gets an entry here before it's implemented.

Template:

```
## <title>  (status: proposed | approved | rejected | done)
Requested by: … · Date: …
Feasibility: …
Architectural consequences: …
Security / privacy implications: … (does it change anything a website can observe?)
Performance implications: …
Decision: …  (owner)
Implementation: commits / PR / tests
```

---

## Ship enterprise policies.json for hardening  (status: rejected)
Date: 2026-11-12
Feasibility: Trivial.
Security implications: Any active enterprise policy makes Firefox set `dom.webserial.enabled=false`. That makes `navigator.serial` absent and separates Umbra users from the Tor Browser crowd. Caught by `tests/integration/test_parity.py`.
Decision: Rejected. Updates are disabled through the anchored patch `umbra-update-disable` instead.

## Ordinary (non-Tor) browsing mode  (status: proposed)
Feasibility: Needs a separate profile and process tree. Mixing it with Tor browsing in one profile is unsafe (shared caches and history).
Security implications: A high risk of user confusion. It needs a strong visual distinction and must never share storage with Tor browsing.
Decision: Waiting for the owner's decision.
