# Writing an Umbra module

Privacy, Source, Vault, Desk, Assistant and the toolbar menu all follow one pattern. Copy it, and your module gets packaged, started and tested the same way.

## 1. Files

```
overlay/<name>/
  Umbra<Name>.sys.mjs     privileged module → resource:///modules/umbra/Umbra<Name>.sys.mjs
  <name>.html/.css/.js    chrome page       → chrome://browser/content/umbra-<name>/
  <name>-logic.mjs        pure logic (no Services/Cc), shared by the page and Node tests
```

Packaging rule (in `tools/umbra_build/build.py`): files ending in `.sys.mjs` go to `modules/umbra/`, and everything else goes to `chrome/browser/content/browser/umbra-<name>/`.

## 2. Startup hook

```python
NAME_CATEGORY = ("category browser-first-window-ready "
                 "resource:///modules/umbra/Umbra<Name>.sys.mjs Umbra<Name>.init")

def patch_<name>_omni(omni):
    ...  # copy the loop from patch_desk_omni
    add_first_window_category(omni, NAME_CATEGORY, "Umbra <Name> startup")
```

Then call it from `patch_browser_omni`. `init()` must be idempotent. It should return early when `umbra.source.mode` is true (the isolated Source instance stays minimal) and add the Tools menu item on `browser-delayed-startup-finished`. Add an entry to `ITEMS` in `overlay/menu/UmbraMenu.sys.mjs`.

## 3. ESR 153 gotchas

- `Services` is a global. Don't import `Services.sys.mjs`, because it doesn't exist.
- CustomizableUI: `moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs`. `getWidget()` returns a `"xul"` wrapper for unknown ids, so compare `provider === PROVIDER_API`. Tor Browser ships a saved toolbar layout, so place widgets once, behind a `umbra.<name>.toolbarPlaced` pref.
- Tor modules: `moz-src:///toolkit/modules/TorConnect.sys.mjs` and `moz-src:///toolkit/components/securitylevel/SecurityLevel.sys.mjs`.
- To read page content, use a `JSWindowActor` (see `UmbraAssistantChild.sys.mjs`). Keep it read-only.
- Logins: Tor Browser sets `security.nocertdb=true`, so the login store is unavailable by default. Never flip it.
- First-run default bookmarks are imported after startup and replace existing bookmarks. Tests must wait for them.

## 4. Non-negotiables

- Pages use a strict CSP: `default-src 'none'`, with `connect-src 'none'` (or `chrome:` for bundled JSON). No remote fonts, images or scripts.
- **No network requests** unless the module's purpose demands one. Any request must go through Tor, and must be documented in `docs/THREAT_MODEL.md` and covered by a leak test.
- **Nothing web-observable.** If a change could alter what a site sees, the parity test (`tests/integration/test_parity.py`) must stay green.
- No custom cryptography. Use WebCrypto/NSS or an audited, vendored library.
- Don't change upstream security prefs. If a module needs one changed, it goes through an IDEAS.md entry and an owner decision.

## 5. Tests and docs (same commit)

- `tests/umbra/<name>-logic.test.mjs`: Node tests for the pure logic.
- `tests/integration/test_<name>.py`: real browser tests (menu entry, page renders, behaviour). Use `tests.browser_driver.start/chrome_eval`. To reach a loopback fixture, set `network.proxy.type=0`, `network.proxy.allow_hijacking_localhost=false` and `dom.security.https_only_mode=false` (test-only).
- `docs/modules/<NAME>.md` with an implemented/experimental/planned table, plus rows in `README.md`, `docs/CHECKLIST.md`, `docs/modules/README.md` and `docs/ARCHITECTURE.md`.
- Inspect a screenshot of the page before you ship it.
