/**
 * Source guard for the update daemon-handoff wiring.
 *
 * HiveMatrix updates only "take" if, after the shell swaps the .app bundle, the
 * launchd daemon is restarted into the new bundle. That wiring is easy to break
 * silently in a refactor and impossible to notice until a user's update stalls
 * with the console still serving the old version. These asserts fail the release
 * (npm test runs before publish) if any leg of the handoff is removed.
 */

import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("Tauri shell hands off to the daemon after installing an update", () => {
  const lib = readFileSync("src-tauri/src/lib.rs", "utf8");

  // The post-install path must restart the daemon before relaunching the shell,
  // otherwise the swapped-on-disk daemon.cjs never runs.
  const install = lib.indexOf("download_and_install");
  const handoff = lib.indexOf("ensure_bundled_daemon_handoff(&update.version)");
  const restart = lib.indexOf("app.restart()");
  assert.notEqual(install, -1, "updater must download_and_install");
  assert.notEqual(handoff, -1, "post-install must call ensure_bundled_daemon_handoff");
  assert.ok(install < handoff && handoff < restart, "handoff must run after install, before app.restart()");

  // The handoff itself: evict the stale port owner, (re)start launchd, verify version.
  assert.match(lib, /fn ensure_bundled_daemon_handoff/);
  assert.match(lib, /evict_replaceable_daemon_port_owners\(\)/);
  assert.match(lib, /kickstart_launchd_daemon\(\)/);
  assert.match(lib, /wait_for_daemon_version\(app_version/);
});

test("setup() evicts a stale port squatter before spawning the bundled daemon", () => {
  const lib = readFileSync("src-tauri/src/lib.rs", "utf8");
  // In the stale-daemon / no-launchd branch, eviction must precede the spawn so
  // the new bundled daemon can bind :3747 instead of hitting EADDRINUSE.
  const branch = lib.slice(lib.indexOf("fn run()"));
  const evict = branch.indexOf("evict_replaceable_daemon_port_owners();");
  const spawn = branch.indexOf("spawn_bundled_daemon(app)", evict);
  assert.notEqual(evict, -1, "setup() must evict a replaceable squatter");
  assert.ok(evict !== -1 && spawn !== -1 && evict < spawn, "eviction must run before spawn_bundled_daemon");
});

test("daemon self-heals when the bundle is swapped underneath it", () => {
  const index = readFileSync("src/daemon/index.ts", "utf8");
  assert.match(index, /startSelfHealLoop/, "daemon boot must start the self-heal loop");

  const selfHeal = readFileSync("src/lib/updater/self-heal.ts", "utf8");
  // Compares the running (compiled-in) version to the on-disk bundle and
  // kickstarts launchd on drift — the leg that rescues users updating FROM a
  // shell that predates the handoff.
  assert.match(selfHeal, /VERSION as RUNNING_VERSION/);
  assert.match(selfHeal, /getBundledVersion/);
  assert.match(selfHeal, /restartViaLaunchd/);
  assert.match(selfHeal, /compareVersions\(onDiskVersion, runningVersion\) > 0/);
});
