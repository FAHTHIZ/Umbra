# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Use [GitHub private vulnerability reporting](https://github.com/FAHTHIZ/Umbra/security/advisories/new) instead.

Include the Umbra version (`about:support` → `umbra.version`, or `Browser/umbra_version.json`), your platform, reproduction steps, and the impact.

Issues in the **underlying Tor Browser or Firefox engine** should also be reported upstream: [Tor Project security](https://gitlab.torproject.org/tpo/applications/tor-browser/-/issues) and [Mozilla security](https://www.mozilla.org/security/).

## Supported versions

Only the latest Umbra release is supported. It always tracks the latest stable Tor Browser release.

## Design documents

- [Threat model](docs/THREAT_MODEL.md)
- [Security architecture](docs/SECURITY_ARCHITECTURE.md)
- [Access Engine security boundaries and acceptance tests](docs/UMBRA_ACCESS_ENGINE.md)
- [Access Engine technology and licensing review](docs/ACCESS_ENGINE_RESEARCH.md)
