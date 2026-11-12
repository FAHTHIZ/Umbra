# Release process

1. Make sure `main` is green, including the parity and leak suites.
2. Update `UMBRA_VERSION` in `tools/umbra_build/__init__.py` and write `docs/RELEASE_NOTES.md`.
3. `git tag -s vX.Y.Z && git push origin vX.Y.Z`
4. The `Release` workflow rebuilds from scratch, reruns the unit, integration and leak tests, and publishes the tarball and `SHA256SUMS`.
5. Verify the published checksum locally against a local build. Builds are deterministic, so the hashes must match.

Upstream security release: bump → build → test → tag within 24 hours. Feature work never blocks a security bump.
