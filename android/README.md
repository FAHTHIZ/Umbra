# Umbra for Android (planned)

Android can't use the overlay track, because APKs are signed, so changing the contents requires our own signing key and a rebuild. The plan:

1. Fork `tor-browser-build` and build the official Tor Browser for Android (Fenix-based, GeckoView) reproducibly.
2. Apply the same Umbra inputs: search config, home page, Explore data and branding as Android resources.
3. Sign with Umbra's own release key, kept offline, and publish on F-Droid (own repo) and GitHub Releases.
4. Run the same parity checks against upstream Tor Browser for Android in an emulator.

Status: 📋 not started. Hardware and CI needs: about 4 h per build on 16 cores. Tracked in [ROADMAP](../docs/ROADMAP.md).
