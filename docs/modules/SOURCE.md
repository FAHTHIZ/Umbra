# Umbra Source (planned, isolated)

A journalist/source workflow: a quick way to reach an organisation's **SecureDrop** onion, with addresses from the SecureDrop directory, plus guidance.

Isolation requirements:
- A separate profile (`-P umbra-source`) with history off, the Safest security level, and no extensions.
- No shared storage with the main profile, and no shared Desk notes.
- Umbra does **not** implement its own submission system. It links to SecureDrop, which is audited, and we don't reinvent it.
- Docs warn clearly: use Tails for high-risk submissions, and Umbra on a personal device is weaker.
