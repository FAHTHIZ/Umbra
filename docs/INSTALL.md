# Installing Umbra

## Linux x86-64 and aarch64 (supported)

Requirements: a 64-bit glibc distribution (Ubuntu 22.04+, Debian 12+, Fedora 38+ or similar), GTK 3, and about 500 MB of disk space.

1. Download `umbra-<version>-linux-x86_64.tar.xz` (or `linux-aarch64` for 64-bit ARM: Raspberry Pi 4/5 with a 64-bit OS, ARM laptops) and `SHA256SUMS` from [Releases](https://github.com/FAHTHIZ/Umbra/releases).
2. Verify: `sha256sum -c --ignore-missing SHA256SUMS`
3. Extract: `tar xf umbra-*-linux-*.tar.xz`
4. Run: `cd umbra && ./start-umbra.desktop`
5. Optional menu entry: `./start-umbra.desktop --register-app`

Umbra is portable. It keeps its whole profile inside its own folder. To uninstall, delete the folder (and run `--unregister-app` first if you registered it).

### First connection

Umbra opens the Tor connection screen. Click **Connect**. If Tor is blocked on your network, choose **Configure Connection…** and select a bridge. Snowflake and obfs4 are built in, and you can request private bridges from https://bridges.torproject.org.

### Updating

Umbra 0.x has **no automatic updater**. Upstream's updater is disabled because it would replace Umbra with stock Tor Browser. Instead, Umbra shows a **release notice bar** when a new version is published. Once a day, after Tor connects, it makes one anonymous request over Tor for the latest version number, and it never downloads anything itself. Turn it off with `umbra.update.notify = false` in `about:config`. To update, download the new release and replace the folder. Your profile lives at `umbra/Browser/TorBrowser/Data`; copy it across if you enabled history or bookmarks.

## Windows x86-64 (experimental)

1. Download `umbra-<version>-windows-x86_64.zip` and `SHA256SUMS` from [Releases](https://github.com/FAHTHIZ/Umbra/releases).
2. Verify it in PowerShell: `Get-FileHash umbra-*-windows-x86_64.zip` and compare the result with `SHA256SUMS`.
3. Extract it anywhere you can write to, such as your Desktop or a USB stick. It's portable.
4. Run `Umbra\Start Umbra.cmd` (or `Umbra\Browser\firefox.exe`).

Notes: the executables keep Tor Project's original Authenticode signatures, so the taskbar and .exe icon still show Tor Browser's icon. Umbra only changes the signed program's data files (`omni.ja`) and adds window icons.

## macOS, Android

Not available yet. See the [roadmap](ROADMAP.md). Please don't use unofficial builds that claim to be Umbra.
