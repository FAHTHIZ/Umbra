# Native desktop app

Umbrella has a Tauri 2 desktop shell. The app is a discovery and launch workspace; it deliberately does not render arbitrary websites inside its own WebView.

## Local build

Requirements: Node.js 20+, Rust stable, and Tauri's platform prerequisites: https://v2.tauri.app/start/prerequisites/

Commands:
- npm install
- npm run app:dev
- npm run app:build

On Linux, install the WebKitGTK and GTK development packages listed in Tauri prerequisites before building.

## Connect Tor Browser

1. Download Tor Browser only from https://www.torproject.org/download/.
2. Install or extract it using official instructions.
3. In Umbrella, open Privacy Center and choose the Tor Browser installation folder. On macOS select Tor Browser.app; on Windows and Linux select the extracted Tor Browser folder.
4. Use "Open with Tor Browser" or enter a valid v3 .onion address in Umbrella's address/search field.

The native command checks the expected installation layout, validates the target URL, and starts the selected executable without a shell. If the browser is missing or launch fails, Umbrella does not open the address in the system default browser. This folder-layout check does not cryptographically prove the installation origin, so download it from the official site.

## Network model

Tor is a network, not a VPN. Umbrella does not ship its own Tor daemon and does not create circuits. It asks the separately installed Tor Browser to open a URL. The browser is responsible for routing the request; check its own connection indicator. Do not assume a VPN plus Tor is automatically safer.

## Data minimization

Umbrella stores only the selected Tor Browser installation directory in its local app config. Search terms remain in volatile page memory. Bookmarks currently remain in localStorage and are not encrypted; do not use this prototype for sensitive case notes or source identities.

## Future work required

- Signed release builds and reproducible dependency policy
- Verify browser integrity / OS code signing where practical
- Test behavior on Windows/macOS/Linux with supported Tor Browser packages
- Explicit browser route status beyond "process launched"
- Dedicated encrypted case storage and safe document inspection
- Independent security review before high-risk journalistic use
