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
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

const DAEMON_PORT: u16 = 3747;

// The app icon is a single fixed identity: the green hive-flower on white. There
// is no light/dark choice — the bundled icon.icns already carries it; this runtime
// override just guarantees the dock shows it even on an unsigned/dev launch.
const DOCK_ICON_RESOURCE: &str = "icons/app-icon-dark-green.png";

#[cfg(target_os = "macos")]
fn apply_runtime_dock_icon(app: &tauri::App) {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let icon_name = DOCK_ICON_RESOURCE;
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

/// Minimal HTTP GET /health. Returns the daemon's reported version only when
/// HiveMatrix answers ok, so a foreign listener squatting on the port isn't
/// mistaken for a healthy daemon.
fn daemon_health_version() -> Option<String> {
    let addr = match format!("127.0.0.1:{DAEMON_PORT}").parse() {
        Ok(a) => a,
        Err(_) => return None,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
        Ok(s) => s,
        Err(_) => return None,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(600)));
    let req = "GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(req.as_bytes()).is_err() {
        return None;
    }
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    if !buf.contains("\"status\":\"ok\"") {
        return None;
    }
    let marker = "\"version\":\"";
    let start = buf.find(marker)? + marker.len();
    let rest = &buf[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn wait_for_daemon_version(version: &str, timeout: Duration) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if daemon_health_version().as_deref() == Some(version) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
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
    let mut cmd = Command::new(&node);
    cmd.arg(&cjs)
        .env("HIVEMATRIX_NODE_BIN", &node)
        .env("HIVEMATRIX_PORT", DAEMON_PORT.to_string())
        .env("NODE_ENV", "production");
    if let Ok(home) = std::env::var("HOME") {
        cmd.current_dir(home);
    }
    match cmd.spawn() {
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

/// Decode %XX sequences in a URL query-parameter value (base64 chars need this).
fn percent_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut iter = s.chars();
    while let Some(c) = iter.next() {
        if c == '%' {
            let h = iter.next().unwrap_or('0');
            let l = iter.next().unwrap_or('0');
            match (h.to_digit(16), l.to_digit(16)) {
                (Some(hv), Some(lv)) => result.push(((hv * 16 + lv) as u8) as char),
                _ => { result.push('%'); result.push(h); result.push(l); }
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Handle `hivematrix://activate?key=<base64-or-json>` deep-links by forwarding
/// the key to the daemon's /license/activate endpoint. Runs retries in a
/// background thread so the deep-link handler returns immediately.
fn handle_hivematrix_url(url: &str) {
    if !url.starts_with("hivematrix://activate") {
        return;
    }
    let key = url.splitn(2, '?').nth(1).and_then(|query| {
        query.split('&')
            .find(|p| p.starts_with("key="))
            .map(|p| percent_decode(p.trim_start_matches("key=")))
    });
    let key = match key {
        Some(k) if !k.is_empty() => k,
        _ => { log::warn!("deep-link: hivematrix://activate missing key param"); return; }
    };
    std::thread::spawn(move || forward_activate_to_daemon(&key));
}

/// POST { key } to the daemon's /license/activate endpoint with retries to
/// tolerate the race between app launch and daemon startup.
fn forward_activate_to_daemon(key: &str) {
    let key_json = match serde_json::to_string(key) {
        Ok(s) => s,
        Err(_) => return,
    };
    let body = format!(r#"{{"key":{key_json}}}"#);
    let body_len = body.len();
    let request = format!(
        "POST /license/activate HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {body_len}\r\nConnection: close\r\n\r\n{body}"
    );
    for attempt in 0..5u32 {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(800));
        }
        let addr: std::net::SocketAddr = match format!("127.0.0.1:{DAEMON_PORT}").parse() {
            Ok(a) => a,
            Err(_) => return,
        };
        let mut stream = match std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(500)) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let _ = stream.set_write_timeout(Some(std::time::Duration::from_millis(1000)));
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(1000)));
        if stream.write_all(request.as_bytes()).is_err() { continue; }
        let mut resp = String::new();
        let _ = stream.read_to_string(&mut resp);
        if resp.contains("\"state\":") {
            log::info!("deep-link: license activate succeeded");
            return;
        }
        log::warn!("deep-link: activate attempt {} response: {}", attempt + 1,
            resp.trim().chars().take(200).collect::<String>());
    }
    log::error!("deep-link: all activate attempts exhausted for key (first 20 chars): {}…",
        key.chars().take(20).collect::<String>());
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

fn daemon_launch_agent_path() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(|h| {
        std::path::Path::new(&h)
            .join("Library/LaunchAgents/com.hivematrix.daemon.plist")
    })
}

fn is_replaceable_hivematrix_daemon_command(command: &str) -> bool {
    let command = command.trim();
    if command.is_empty() {
        return false;
    }
    let lower = command.to_ascii_lowercase();
    let source_daemon = lower.contains("src/daemon/index.ts")
        && (lower.contains("tsx/esm") || lower.contains("--import"));
    let bundled_daemon = command.contains("HiveMatrix.app/Contents/Resources/daemon/daemon.cjs")
        || (command.contains("HiveMatrix.app/Contents/Resources/daemon/bin/node") && command.contains("daemon.cjs"));
    source_daemon || bundled_daemon
}

#[cfg(target_os = "macos")]
fn command_output(cmd: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(cmd).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(target_os = "macos")]
fn daemon_port_owner_pids() -> Vec<u32> {
    command_output("lsof", &["-tiTCP:3747", "-sTCP:LISTEN"])
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect()
}

#[cfg(target_os = "macos")]
fn process_command(pid: u32) -> Option<String> {
    command_output("ps", &["-p", &pid.to_string(), "-o", "command="])
}

#[cfg(target_os = "macos")]
fn terminate_process(pid: u32) {
    let pid_s = pid.to_string();
    let _ = Command::new("kill").arg("-TERM").arg(&pid_s).status();
    for _ in 0..10 {
        if !daemon_port_owner_pids().contains(&pid) {
            return;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    let _ = Command::new("kill").arg("-KILL").arg(&pid_s).status();
}

#[cfg(target_os = "macos")]
fn evict_replaceable_daemon_port_owners() {
    for pid in daemon_port_owner_pids() {
        let command = process_command(pid).unwrap_or_default();
        if is_replaceable_hivematrix_daemon_command(&command) {
            log::warn!("daemon handoff: terminating stale daemon pid={pid} command={command}");
            terminate_process(pid);
        } else {
            log::warn!("daemon handoff: refusing to terminate unknown :{DAEMON_PORT} owner pid={pid} command={command}");
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn evict_replaceable_daemon_port_owners() {}

#[cfg(target_os = "macos")]
fn launchd_domain_label(label: &str) -> Option<String> {
    let uid = Command::new("id").arg("-u").output().ok()?;
    let uid = String::from_utf8_lossy(&uid.stdout).trim().to_string();
    if uid.is_empty() { None } else { Some(format!("gui/{uid}/{label}")) }
}

#[cfg(target_os = "macos")]
fn launchd_domain() -> Option<String> {
    let uid = Command::new("id").arg("-u").output().ok()?;
    let uid = String::from_utf8_lossy(&uid.stdout).trim().to_string();
    if uid.is_empty() { None } else { Some(format!("gui/{uid}")) }
}

#[cfg(target_os = "macos")]
fn cleanup_legacy_hotfix_daemon() {
    if let Some(label) = launchd_domain_label("com.hivematrix.daemon.hotfix") {
        match Command::new("launchctl").arg("bootout").arg(&label).status() {
            Ok(status) if status.success() => log::info!("daemon hotfix cleanup: removed legacy submitted job"),
            _ => {}
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn cleanup_legacy_hotfix_daemon() {}

#[cfg(target_os = "macos")]
fn kickstart_launchd_daemon() {
    if let Some(label) = launchd_domain_label("com.hivematrix.daemon") {
        match Command::new("launchctl").arg("kickstart").arg("-k").arg(&label).status() {
            Ok(status) if status.success() => log::info!("daemon launchd kickstart succeeded"),
            Ok(status) => log::warn!("daemon launchd kickstart exited with {status:?}"),
            Err(e) => log::warn!("daemon launchd kickstart failed: {e}"),
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn kickstart_launchd_daemon() {}

#[cfg(target_os = "macos")]
fn bootstrap_launchd_daemon_if_needed() {
    let Some(domain) = launchd_domain() else { return; };
    let Some(plist) = daemon_launch_agent_path() else { return; };
    if !plist.exists() {
        log::warn!("daemon handoff: launchd plist missing at {plist:?}");
        return;
    }
    match Command::new("launchctl").arg("bootstrap").arg(&domain).arg(&plist).status() {
        Ok(status) if status.success() => log::info!("daemon handoff: launchd bootstrap succeeded"),
        Ok(status) => log::warn!("daemon handoff: launchd bootstrap exited with {status:?} (may already be loaded)"),
        Err(e) => log::warn!("daemon handoff: launchd bootstrap failed: {e}"),
    }
}

#[cfg(not(target_os = "macos"))]
fn bootstrap_launchd_daemon_if_needed() {}

fn ensure_bundled_daemon_handoff(app_version: &str) -> bool {
    if daemon_health_version().as_deref() == Some(app_version) {
        return true;
    }
    evict_replaceable_daemon_port_owners();
    bootstrap_launchd_daemon_if_needed();
    kickstart_launchd_daemon();
    let ok = wait_for_daemon_version(app_version, Duration::from_secs(12));
    if ok {
        log::info!("daemon handoff: daemon now serves app version {app_version}");
    } else {
        log::error!("daemon handoff: daemon did not reach app version {app_version}");
    }
    ok
}

/// Whether to install an available update now. True if a force flag is present
/// (the in-app "Install" button drops it — consumed here) OR config.autoUpdate
/// is true. Default is manual: the console shows an "Update" pill instead.
fn force_update_path() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    std::path::Path::new(&home).join(".hivematrix/.force-update")
}

fn clear_force_update_flag() {
    let _ = std::fs::remove_file(force_update_path());
}

fn should_install_update() -> bool {
    let force = force_update_path();
    if force.exists() {
        let _ = std::fs::remove_file(&force);
        return true;
    }
    // No JSON dep in the shell crate; whitespace-strip then substring-match the
    // daemon's pretty-printed config.json.
    let home = std::env::var("HOME").unwrap_or_default();
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
                let daemon_ok = ensure_bundled_daemon_handoff(&update.version);
                log::info!("updater: installed; daemon handoff ok={daemon_ok}; relaunching");
                app.restart();
            }
            Ok(None) => {
                clear_force_update_flag();
                log::info!("updater: no update available (feed not newer than {current})");
            },
            Err(e) => log::warn!("updater: check FAILED: {e}"),
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
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

            cleanup_legacy_hotfix_daemon();

            // Ensure a daemon is up so the webview's health-poll redirects.
            let app_version = app.package_info().version.to_string();
            if let Some(daemon_version) = daemon_health_version() {
                if daemon_version == app_version {
                    log::info!("daemon already healthy on :{DAEMON_PORT} (version {daemon_version})");
                } else if launchd_agent_installed() {
                    log::warn!("daemon on :{DAEMON_PORT} is stale ({daemon_version}); app is {app_version}; asking launchd to restart bundled daemon");
                    ensure_bundled_daemon_handoff(&app_version);
                } else {
                    // Stale daemon with no launchd agent — a dev/source daemon (or a
                    // leftover bundled one) squatting the port. Evict the replaceable
                    // squatter FIRST; otherwise the freshly spawned bundled daemon
                    // can't bind :{DAEMON_PORT} (EADDRINUSE) and the stale one keeps
                    // serving the old version — the exact "update didn't take" bug.
                    evict_replaceable_daemon_port_owners();
                    if let Some(child) = spawn_bundled_daemon(app) {
                        log::warn!("daemon on :{DAEMON_PORT} was stale ({daemon_version}); evicted squatter and spawned bundled daemon for app {app_version}");
                        *app.state::<DaemonChild>().0.lock().unwrap() = Some(child);
                    }
                }
            } else if launchd_agent_installed() {
                // launchd owns the daemon; it will (re)start it. Spawning our own
                // child here would orphan and squat the port. The webview
                // health-polls until launchd's daemon answers.
                log::info!("daemon not healthy yet, but launchd agent is installed — deferring to launchd");
            } else if let Some(child) = spawn_bundled_daemon(app) {
                *app.state::<DaemonChild>().0.lock().unwrap() = Some(child);
            }

            // Register handler for hivematrix:// deep-links (e.g. license activation).
            // Called both when the app is already running (URL opens it) and on
            // first launch via URL (the plugin replays stored URLs during setup).
            app.deep_link().on_open_url(|event| {
                for url in event.urls() {
                    handle_hivematrix_url(url.as_str());
                }
            });

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
    fn source_daemon_commands_are_replaceable() {
        assert!(is_replaceable_hivematrix_daemon_command(
            "node --import tsx/esm /Users/me/hivematrix/src/daemon/index.ts"
        ));
        assert!(is_replaceable_hivematrix_daemon_command(
            "/opt/homebrew/bin/node --import tsx/esm src/daemon/index.ts"
        ));
    }

    #[test]
    fn bundled_daemon_commands_are_replaceable() {
        assert!(is_replaceable_hivematrix_daemon_command(
            "/Applications/HiveMatrix.app/Contents/Resources/daemon/bin/node /Applications/HiveMatrix.app/Contents/Resources/daemon/daemon.cjs"
        ));
    }

    #[test]
    fn unknown_port_owners_are_not_replaceable() {
        assert!(!is_replaceable_hivematrix_daemon_command(
            "/usr/bin/python3 -m http.server 3747"
        ));
        assert!(!is_replaceable_hivematrix_daemon_command(
            "/Applications/Other.app/Contents/MacOS/Other"
        ));
    }
}
