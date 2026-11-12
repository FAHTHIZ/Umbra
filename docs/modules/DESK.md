# Umbra Desk (experimental)

**Tools → Umbra Desk (research notes)** opens `chrome://browser/content/umbra-desk/desk.html`, a research workspace that leaves nothing behind.

| Part | Status |
|---|---|
| Notes kept in parent-process memory only. They're never written to disk (a test scans the profile for the note text). Shared live across Desk tabs. | ✅ tested |
| Notes cleared on New Identity (`new-identity-requested`) and on restart | ✅ tested |
| Open tabs across windows, grouped by site, plus "Add links to notes" (Markdown) | ✅ tested |
| Close and forget runs upstream's `cmd_newIdentity` (closes tabs, clears state, new circuits) | ✅ wired; the command exists (the full New Identity flow is upstream's) |
| Named tab groups | 📋 planned (Firefox ESR 153 has native tab groups; Desk will surface them, not reimplement them) |
| Optional notes persistence | ❓ owner decision. Persisting would conflict with permanent private browsing. The proposal is an opt-in that stores notes only inside a Vault-encrypted file. |

Fingerprinting: Desk is a chrome-privileged page with no web-exposed API, so it's fingerprint-neutral. The parity test is unaffected.
