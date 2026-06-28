// HiveMatrix Tauri shell.
//
// The window UI is served by the daemon over http (ui/index.html health-polls
// 127.0.0.1:3747 and redirects to /console). The shell's only job here is
// SUPERVISION: make sure a daemon is actually running so that poll succeeds.
//
// - If a healthy daemon is already up (launchd is supervising it from a prior
//   install), do nothing.
// - Otherwise spawn the BUNDLED daemon (Contents/Resources/daemon/bin/node +
//   daemon.cjs) as a child so first-run serves the setup wizard. The wizard's
//   finish step installs the launchd agent; from then on launchd owns 24/7
//   supervision and this child path isn't taken again.
// - The child is killed on app exit so the launchd handoff is clean.
//
// Translocation detection + the "move to /Applications" guard live daemon-side
// (the daemon reads its own process.execPath), because the webview runs in the
// daemon's http origin where Tauri IPC isn't available.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const DAEMON_PORT: u16 = 3747;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AppIconChoice {
    DarkGreen,
    White,
}

fn app_icon_choice_from_config_text(text: &str) -> AppIconChoice {
    serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|config| config.get("appIconChoice").and_then(|choice| choice.as_str()).map(str::to_owned))
        .map(|choice| if choice == "white" { AppIconChoice::White } else { AppIconChoice::DarkGreen })
        .unwrap_or(AppIconChoice::DarkGreen)
}

fn app_icon_choice_from_config_file() -> AppIconChoice {
    let home = match std::env::var("HOME") {
        Ok(home) => home,
        Err(_) => return AppIconChoice::DarkGreen,
    };
    std::fs::read_to_string(std::path::Path::new(&home).join(".hivematrix/config.json"))
        .map(|text| app_icon_choice_from_config_text(&text))
        .unwrap_or(AppIconChoice::DarkGreen)
}

fn app_icon_resource_name(choice: AppIconChoice) -> &'static str {
    match choice {
        AppIconChoice::DarkGreen => "icons/app-icon-dark-green.png",
        AppIconChoice::White => "icons/app-icon-white.png",
    }
}

#[cfg(target_os = "macos")]
fn apply_runtime_dock_icon(app: &tauri::App) {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let icon_name = app_icon_resource_name(app_icon_choice_from_config_file());
    let icon_path = match app.path().resource_dir() {
        Ok(dir) => dir.join(icon_name),
        Err(e) => {
            log::warn!("dock icon: resource_dir unavailable: {e}");
            return;
        }
    };
    let bytes = match std::fs::read(&icon_path) {
        Ok(bytes) => bytes,
        Err(e) => {
            log::warn!("dock icon: failed to read {icon_path:?}: {e}");
            return;
        }
    };
    let mtm = unsafe { MainThreadMarker::new_unchecked() };
    let data = NSData::with_bytes(&bytes);
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        log::warn!("dock icon: failed to decode PNG {icon_path:?}");
        return;
    };
    let ns_app = NSApplication::sharedApplication(mtm);
    unsafe { ns_app.setApplicationIconImage(Some(&image)); }
}

#[cfg(not(target_os = "macos"))]
fn apply_runtime_dock_icon(_app: &tauri::App) {}

#[cfg(target_os = "macos")]
fn apply_macos_vibrancy(window: &tauri::WebviewWindow) {
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
    if let Err(e) = apply_vibrancy(window, NSVisualEffectMaterial::UnderWindowBackground, None, None) {
        log::warn!("vibrancy: {e}");
    }
}

/// Holds the transient first-run daemon child (if we spawned one) so it can be
/// reaped on app exit.
struct DaemonChild(Mutex<Option<Child>>);

/// Minimal HTTP GET /health. Returns true only when *our* daemon answers ok, so
/// a foreign listener squatting on the port isn't mistaken for a healthy daemon.
fn daemon_health_ok() -> bool {
    let addr = match format!("127.0.0.1:{DAEMON_PORT}").parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let req = "GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    buf.contains("\"status\":\"ok\"")
}

/// Spawn the bundled daemon (no system Node / repo checkout needed).
fn spawn_bundled_daemon(app: &tauri::App) -> Option<Child> {
    let res = app.path().resource_dir().ok()?;
    let node = res.join("daemon/bin/node");
    let cjs = res.join("daemon/daemon.cjs");
    if !node.exists() || !cjs.exists() {
        log::warn!("bundled daemon not found under {res:?} — not spawning");
        return None;
    }
    match Command::new(&node)
        .arg(&cjs)
        .env("HIVEMATRIX_NODE_BIN", &node)
        .env("HIVEMATRIX_PORT", DAEMON_PORT.to_string())
        .env("NODE_ENV", "production")
        .spawn()
    {
        Ok(child) => {
            log::info!("spawned bundled daemon pid={}", child.id());
            Some(child)
        }
        Err(e) => {
            log::error!("failed to spawn bundled daemon: {e}");
            None
        }
    }
}

/// Whether the daemon's launchd agent is installed (i.e. onboarding ran). When
/// it is, launchd owns the daemon's lifecycle. The app must NOT spawn its own
/// child in that case: the child orphans (reparents to launchd) and squats
/// :3747, so the real launchd-managed daemon crash-loops on EADDRINUSE and the
/// port keeps serving stale code — exactly the failure seen after an update.
fn launchd_agent_installed() -> bool {
    std::env::var("HOME")
        .map(|h| {
            std::path::Path::new(&h)
                .join("Library/LaunchAgents/com.hivematrix.daemon.plist")
                .exists()
        })
        .unwrap_or(false)
}

/// Whether to install an available update now. True if a force flag is present
/// (the in-app "Install" button drops it — consumed here) OR config.autoUpdate
/// is true. Default is manual: the console shows an "Update" pill instead.
fn should_install_update() -> bool {
    let home = std::env::var("HOME").unwrap_or_default();
    let force = std::path::Path::new(&home).join(".hivematrix/.force-update");
    if force.exists() {
        let _ = std::fs::remove_file(&force);
        return true;
    }
    // No JSON dep in the shell crate; whitespace-strip then substring-match the
    // daemon's pretty-printed config.json.
    std::fs::read_to_string(std::path::Path::new(&home).join(".hivematrix/config.json"))
        .map(|t| t.split_whitespace().collect::<String>().contains("\"autoUpdate\":true"))
        .unwrap_or(false)
}

/// Best-effort background update check via the Tauri updater (GitHub Releases
/// feed). Because the UI is served by the daemon over http (no Tauri IPC), the
/// check is driven from Rust, not JS. No-ops safely when the updater isn't
/// configured (no signing key / endpoint yet). On install it relaunches; the
/// daemon's boot gate then runs migrations + records the new version.
#[cfg(desktop)]
fn check_for_update(app: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    tauri::async_runtime::spawn(async move {
        let current = app.package_info().version.to_string();
        log::info!("updater: checking feed (current version {current})");
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => { log::warn!("updater: not configured: {e}"); return; }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                log::info!("updater: update available {} -> {}", current, update.version);
                if !should_install_update() {
                    log::info!("updater: auto-update off — leaving {} for the in-app Install button", update.version);
                    return;
                }
                if let Err(e) = update.download_and_install(
                    |_, _| {},
                    || log::info!("updater: download complete, installing…"),
                ).await {
                    log::error!("updater: download/install FAILED: {e}");
                    return;
                }
                // The console + REST API are served by the launchd-supervised
                // daemon, a SEPARATE process from this shell. Updating the .app
                // swaps daemon.cjs on disk, but the running daemon keeps the old
                // code in memory until it restarts — so kick it before we
                // relaunch, otherwise the user sees the old console post-update.
                let kick = std::process::Command::new("sh")
                    .arg("-c")
                    .arg("launchctl kickstart -k gui/$(id -u)/com.hivematrix.daemon")
                    .status();
                log::info!("updater: installed; daemon kickstart -> {kick:?}; relaunching");
                app.restart();
            }
            Ok(None) => log::info!("updater: no update available (feed not newer than {current})"),
            Err(e) => log::warn!("updater: check FAILED: {e}"),
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(DaemonChild(Mutex::new(None)))
        .setup(|app| {
            // Log in release too — to ~/Library/Logs/HiveMatrix/app.log — so the
            // updater (and any other) failures are diagnosable. They were
            // previously invisible because the log plugin was debug-only, which
            // is exactly why the silent auto-update failure couldn't be traced.
            let log_dir = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default())
                .join("Library/Logs/HiveMatrix");
            let _ = std::fs::create_dir_all(&log_dir);
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .target(tauri_plugin_log::Target::new(
                        tauri_plugin_log::TargetKind::Folder { path: log_dir, file_name: Some("app".into()) },
                    ))
                    .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout))
                    .build(),
            )?;

            apply_runtime_dock_icon(app);

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                apply_macos_vibrancy(&window);
            }

            // Ensure a daemon is up so the webview's health-poll redirects.
            if daemon_health_ok() {
                log::info!("daemon already healthy on :{DAEMON_PORT}");
            } else if launchd_agent_installed() {
                // launchd owns the daemon; it will (re)start it. Spawning our own
                // child here would orphan and squat the port. The webview
                // health-polls until launchd's daemon answers.
                log::info!("daemon not healthy yet, but launchd agent is installed — deferring to launchd");
            } else if let Some(child) = spawn_bundled_daemon(app) {
                *app.state::<DaemonChild>().0.lock().unwrap() = Some(child);
            }

            // Check for an app update in the background (no-op until configured).
            #[cfg(desktop)]
            check_for_update(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Reap the transient first-run child so launchd can take over cleanly.
                if let Some(state) = app_handle.try_state::<DaemonChild>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_icon_choice_defaults_to_dark_green_for_missing_or_invalid_config() {
        assert_eq!(app_icon_choice_from_config_text(""), AppIconChoice::DarkGreen);
        assert_eq!(app_icon_choice_from_config_text("{}"), AppIconChoice::DarkGreen);
        assert_eq!(
            app_icon_choice_from_config_text(r#"{"appIconChoice":"purple"}"#),
            AppIconChoice::DarkGreen
        );
    }

    #[test]
    fn app_icon_choice_reads_white_from_config() {
        assert_eq!(
            app_icon_choice_from_config_text(r#"{"appIconChoice":"white"}"#),
            AppIconChoice::White
        );
    }

    #[test]
    fn app_icon_choice_maps_to_bundled_resource_names() {
        assert_eq!(app_icon_resource_name(AppIconChoice::DarkGreen), "icons/app-icon-dark-green.png");
        assert_eq!(app_icon_resource_name(AppIconChoice::White), "icons/app-icon-white.png");
    }
}
