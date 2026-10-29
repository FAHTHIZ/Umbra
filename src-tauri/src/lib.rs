use serde::{Deserialize, Serialize};
use std::{
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use url::Url;

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(default)]
struct LocalSettings {
    tor_browser_root: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserStatus {
    configured: bool,
    cancelled: bool,
    message: String,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|_| "Could not locate Umbrella's local configuration directory.")?;
    fs::create_dir_all(&directory).map_err(|_| "Could not create Umbrella's local configuration directory.")?;
    Ok(directory.join(SETTINGS_FILE))
}

fn read_settings(app: &AppHandle) -> LocalSettings {
    let Ok(path) = settings_path(app) else { return LocalSettings::default(); };
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<LocalSettings>(&bytes).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, settings: &LocalSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec(settings).map_err(|_| "Could not serialize local settings.")?;
    fs::write(&temporary, bytes).map_err(|_| "Could not save local settings.")?;
    fs::rename(&temporary, &path).map_err(|_| "Could not finalize local settings.")?;
    Ok(())
}

fn is_valid_v3_onion_host(host: &str) -> bool {
    let Some(label) = host.strip_suffix(".onion") else { return false; };
    label.len() == 56 && label.bytes().all(|byte| byte.is_ascii_lowercase() || (b'2'..=b'7').contains(&byte))
}

fn validate_navigation_target(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw).map_err(|_| "Enter a complete HTTPS address or a valid v3 .onion address.")?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Addresses containing embedded usernames or passwords are not allowed.".into());
    }
    let host = parsed.host_str().ok_or("The address has no hostname.")?.to_ascii_lowercase();
    if host.ends_with(".onion") {
        if !is_valid_v3_onion_host(&host) {
            return Err("Only valid v3 onion hostnames are accepted.".into());
        }
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err("Onion addresses must use HTTP or HTTPS.".into());
        }
    } else {
        if parsed.scheme() != "https" {
            return Err("Ordinary web destinations must use HTTPS; onion addresses are the only HTTP exception.".into());
        }
        if host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal") || host.ends_with(".lan") {
            return Err("Local-network destinations are not allowed from Umbrella's navigation handoff.".into());
        }
        let unbracketed = host.trim_matches(|character| character == '[' || character == ']');
        if unbracketed.parse::<IpAddr>().is_ok() || !host.contains('.') {
            return Err("Use a public HTTPS hostname or a valid v3 onion address.".into());
        }
    }
    Ok(parsed)
}

fn resolve_tor_browser(root: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|_| "The selected Tor Browser folder no longer exists.")?;
    if !root.is_dir() { return Err("Select the Tor Browser installation folder, not a file.".into()); }

    #[cfg(target_os = "windows")]
    let (binary, marker_ok) = (root.join("Browser/firefox.exe"), root.join("Browser/TorBrowser").is_dir());

    #[cfg(target_os = "linux")]
    let (binary, marker_ok) = (root.join("start-tor-browser"), root.join("Browser/TorBrowser").is_dir());

    #[cfg(target_os = "macos")]
    let (binary, marker_ok) = {
        let bundle = if root.join("Contents/MacOS/firefox").is_file() {
            root.clone()
        } else {
            root.join("Tor Browser.app")
        };
        (bundle.join("Contents/MacOS/firefox"), bundle.join("Contents/Info.plist").is_file())
    };

    #[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
    return Err("Automatic Tor Browser launching is not supported on this operating system yet.".into());

    #[cfg(any(target_os = "windows", target_os = "linux", target_os = "macos"))]
    {
        if !binary.is_file() || !marker_ok {
            return Err("The selected folder does not match the expected Tor Browser layout. Download Tor Browser from torproject.org and choose its installation folder.".into());
        }
        Ok(binary)
    }
}

fn current_status(app: &AppHandle, cancelled: bool) -> BrowserStatus {
    match read_settings(app).tor_browser_root {
        Some(root) => {
            let valid = resolve_tor_browser(Path::new(&root)).is_ok();
            BrowserStatus {
                configured: valid,
                cancelled,
                message: if valid {
                    "A Tor Browser folder is configured. Umbrella hands navigation to that installation; check Tor Browser's own connection indicator before sensitive work.".into()
                } else {
                    "The saved Tor Browser folder is unavailable or no longer matches the expected layout. Choose the official installation folder again.".into()
                },
            }
        }
        None => BrowserStatus {
            configured: false,
            cancelled,
            message: "Tor Browser is not configured. Choose the installation folder you downloaded from the official Tor Project website. No navigation will fall back to a normal browser.".into(),
        },
    }
}

#[tauri::command]
fn get_tor_browser_status(app: AppHandle) -> BrowserStatus {
    current_status(&app, false)
}

#[tauri::command]
fn configure_tor_browser(app: AppHandle) -> Result<BrowserStatus, String> {
    let Some(selected) = app.dialog().file().blocking_pick_folder() else {
        return Ok(current_status(&app, true));
    };
    let selected = selected.into_path().map_err(|_| "The selected folder is not a local filesystem path.")?;
    let root = fs::canonicalize(&selected).map_err(|_| "The selected folder cannot be accessed.")?;
    resolve_tor_browser(&root)?;
    write_settings(&app, &LocalSettings { tor_browser_root: Some(root.to_string_lossy().into_owned()) })?;
    Ok(current_status(&app, false))
}

#[tauri::command]
fn open_in_tor_browser(app: AppHandle, address: String) -> Result<(), String> {
    let target = validate_navigation_target(&address)?;
    let root = read_settings(&app).tor_browser_root.ok_or_else(|| {
        "Tor Browser is not configured. Open Privacy Center and choose its installation folder. No connection was made.".to_string()
    })?;
    let binary = resolve_tor_browser(Path::new(&root))?;
    // The address is one argument, never shell-interpreted. No default-browser fallback exists.
    Command::new(binary)
        .arg(target.as_str())
        .spawn()
        .map(|_| ())
        .map_err(|_| "Could not launch Tor Browser. No fallback browser was used; re-check the selected official installation.")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_tor_browser_status,
            configure_tor_browser,
            open_in_tor_browser
        ])
        .run(tauri::generate_context!())
        .expect("error while running Umbrella");
}

#[cfg(test)]
mod tests {
    use super::validate_navigation_target;

    fn onion_address() -> String {
        format!("http://{}.onion/", "a".repeat(56))
    }

    #[test]
    fn accepts_a_valid_v3_onion_address() {
        assert!(validate_navigation_target(&onion_address()).is_ok());
    }

    #[test]
    fn rejects_invalid_onion_addresses() {
        assert!(validate_navigation_target("http://short.onion/").is_err());
        assert!(validate_navigation_target("http://example.onion.attacker.test/").is_err());
        assert!(validate_navigation_target("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_credentials_and_non_https_regular_sites() {
        assert!(validate_navigation_target("https://user:pass@example.org/").is_err());
        assert!(validate_navigation_target("http://example.org/").is_err());
    }

    #[test]
    fn rejects_local_network_destinations() {
        assert!(validate_navigation_target("https://localhost/").is_err());
        assert!(validate_navigation_target("https://127.0.0.1/").is_err());
        assert!(validate_navigation_target("https://printer.local/").is_err());
    }
}
