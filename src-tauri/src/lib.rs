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

/// Best-effort background update check via the Tauri updater (GitHub Releases
/// feed). Because the UI is served by the daemon over http (no Tauri IPC), the
/// check is driven from Rust, not JS. No-ops safely when the updater isn't
/// configured (no signing key / endpoint yet). On install it relaunches; the
/// daemon's boot gate then runs migrations + records the new version.
#[cfg(desktop)]
fn check_for_update(app: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => { log::info!("updater not configured: {e}"); return; }
        };
        match updater.check().await {
            Ok(Some(update)) => {
                log::info!("update available: {}", update.version);
                if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                    log::error!("update install failed: {e}");
                    return;
                }
                // The console + REST API are served by the launchd-supervised
                // daemon, a SEPARATE process from this shell. Updating the .app
                // swaps daemon.cjs on disk, but the running daemon keeps the old
                // code in memory until it restarts — so kick it before we
                // relaunch, otherwise the user sees the old console post-update.
                log::info!("update installed — restarting daemon + relaunching");
                let _ = std::process::Command::new("sh")
                    .arg("-c")
                    .arg("launchctl kickstart -k gui/$(id -u)/com.hivematrix.daemon")
                    .status();
                app.restart();
            }
            Ok(None) => log::info!("no update available"),
            Err(e) => log::warn!("update check failed: {e}"),
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
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Ensure a daemon is up so the webview's health-poll redirects.
            if daemon_health_ok() {
                log::info!("daemon already healthy on :{DAEMON_PORT}");
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
