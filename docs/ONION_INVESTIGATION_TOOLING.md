# Onion investigation tooling

Umbra includes **TorBot** as an optional, separately maintained investigation utility. It is pinned as a Git submodule so it can be reviewed and updated independently of the browser.

- Upstream: https://github.com/DedSecInside/TorBot
- Pinned upstream commit: `4a6f369602592eb6d469b10bfc0cb6d4b3ea10e2`
- License: GNU GPL-3.0 (see `vendor/torbot/LICENSE.md`)
- Purpose: inspect a specifically supplied onion URL, check reachability, and map a shallow link tree from pages the service publicly serves. TorBot also documents JSON output and an evidence-first analysis command.

## Initialize

```bash
git submodule update --init --recursive vendor/torbot
```

TorBot is a standalone Python utility; it is **not** part of Umbra's browser runtime or release build. Its dependencies and runtime should be isolated from the browser.

## Conservative investigation profile

Use a manually selected target, keep Tor SOCKS routing enabled, and begin with depth 1:

```bash
python vendor/torbot/main.py --url http://<known-v3-onion-address>.onion --depth 1 --quiet --save json
```

Do not use `--disable-socks5` for onion investigations. Do not turn this into an indiscriminate crawler: keep collection scoped to a documented case and a known target, respect service stability, and stop if the service presents a legal or safety warning.

## Evidence and safety boundaries

- Collect only material the service presents publicly without defeating an access control.
- Do not supply cookies, session tokens, credentials, MFA codes, payment details, or browser profiles.
- Do not automate account creation, checkout, payment, CAPTCHA solving, or authentication challenges.
- Do not download suspected illegal material merely to preserve it. Record the URL, time, visible context, and a minimal description, then follow the relevant authority's evidence-handling instructions.
- Treat crawler output and AI-generated summaries as leads, not proof. Preserve original output, record tool/version and collection time, hash evidence files, and have a human verify each claim before reporting.
- TorBot is not a forensic certification or a guarantee that evidence will be admissible.

This addition supplies a bounded discovery/triage tool for Umbra's investigation workflow. It does not bypass sign-in, payment, or other server-enforced restrictions.
