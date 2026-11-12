# Umbra Assistant (experimental, local-only, no model)

**Tools → Umbra Assistant: summarise this page** analyses the current tab entirely on this device and opens the results in a new tab.

| Part | Status |
|---|---|
| Key sentences: an extractive summary that quotes sentences verbatim from the page, ranked by term frequency and shown in document order. Prefers `<main>`/`<article>` content. | ✅ tested |
| Key terms, reading time, H1–H3 outline | ✅ tested |
| Onion addresses found in the page text and links (shown as found, not vouched for) | ✅ tested |
| External links, deduplicated, with only http(s) kept | ✅ tested |
| Works on http, https, onion and file pages through a read-only `JSWindowActor` (`UmbraAssistantChild`) | ✅ tested |
| Generative AI (LLM summaries, chat, translation) | ⛔ not shipped, see below |

## Why there's no AI model

Tor Browser deliberately sets `browser.ml.enable=false`, `browser.ml.chat.enabled=false` and `browser.translations.enable=false`. Firefox's local ML and Translations download models and engines from Mozilla's Remote Settings at runtime. That creates distinctive network activity and an installed-model state that can differ between users, and both cut against "everyone looks the same". Cloud assistants would send page content to a third party. Umbra keeps all three prefs at upstream values, and `tests/integration/test_assistant.py` asserts this.

The current Assistant uses no model, so it can't invent facts. Every sentence it shows is on the page.

## Possible future direction (owner decision)

A local model would have to ship pinned and hashed **inside the release** (no runtime downloads), run in the sandboxed inference process, be the same for all users, and pass the fingerprint-parity suite. It would add hundreds of MB to the download and memory use. This is recorded in [IDEAS.md](../IDEAS.md) as needing an owner decision.
