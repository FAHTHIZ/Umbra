# Data inventory

The design rule is data minimization. Umbrella should not collect every possible metadata field merely because it can. Some metadata may be important evidence; a future evidence feature should preserve originals only with explicit user intent, clear provenance and a separate protected storage design.

| Data | Present behavior | Storage / transmission | Risk and rule |
| --- | --- | --- | --- |
| Local search query | Used for in-page filtering only | Volatile page memory; not persisted by Umbrella | Do not add analytics or query logging |
| Catalogue records | Loaded from the same origin | Bundled JSON served with the app | Keep provenance and revalidate links before releases |
| Bookmark IDs | Saved when user clicks bookmark | Browser localStorage, unencrypted | Not suitable for sensitive investigations or shared profiles |
| External source URL | Opened after an explicit button click | Browser requests the selected external site | The external site can observe request metadata |
| Onion address | Shown and copied after explicit action | Clipboard only; manually opened in Tor Browser | Do not fetch via an Umbrella server or send to third parties |
| IP address and request timing | Not collected by Umbrella JavaScript | Static host / local network may observe ordinary HTTP(S) requests | Hosting logs remain outside this app's control |
| Cookies / login data | No Umbrella login or cookies created by the app | Browser-managed, destination-dependent | Do not add session synchronization |
| Browser fingerprint | Not read by Umbrella JavaScript | Browser and site behavior may still reveal attributes | A website UI cannot eliminate fingerprinting |
| Downloads and document metadata | Not handled by this prototype | None collected | Future work requires sandboxed inspection and explicit consent |
| EXIF / GPS / author fields | Not read or removed | None collected | Future evidence feature must never silently mutate originals |
| Case notes or source identities | Not supported | No app storage | Must never be added to logs, telemetry or URLs |
| Crash reports | No reporting SDK | No app crash upload | Do not add cloud reporting without opt-in design |
| Updates / software supply chain | Static files deployed by GitHub Actions | GitHub infrastructure | Validate workflow permissions and dependency/action versions |

## Data not to collect

No keystroke telemetry, session replay, third-party analytics, fingerprinting, cross-site tracking, private query history, automatic onion-page previews, source identity fields, or silent uploads of evidence.
