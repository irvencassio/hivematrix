/**
 * App-bundle path resolution + the /Applications translocation guard.
 *
 * When the daemon runs from inside the packaged app it is launched by the bundled
 * Node at:
 *   /Applications/HiveMatrix.app/Contents/Resources/daemon/bin/node
 * so the daemon can locate its own bundle, and the launchd plist it installs can
 * point at stable absolute paths inside that bundle.
 *
 * Gatekeeper "app translocation" runs a quarantined app from a randomized
 * read-only mount (…/AppTranslocation/<uuid>/d/HiveMatrix.app). Baking that path
 * into a launchd plist or reading the bundle Info.plist from it produces garbage
 * that breaks after the mount disappears — so any step that persists a bundle
 * path must refuse until the app is in /Applications. The DMG already ships the
 * drag-to-/Applications symlink; the wizard surfaces the prompt.
 *
 * execPath is injectable so this is unit-testable without a real bundle.
 */

import { sep } from "path";

const RESOURCES_DAEMON_BIN = ["Contents", "Resources", "daemon", "bin", "node"];

/**
 * The `<…>.app` root if the daemon is running from inside a packaged bundle,
 * else null (dev run via tsx, or the bundled node moved out of place).
 */
export function getAppBundleRoot(execPath: string = process.execPath): string | null {
  const parts = execPath.split(sep);
  // Expect the tail to be …/<App>.app/Contents/Resources/daemon/bin/node
  const tail = parts.slice(-RESOURCES_DAEMON_BIN.length);
  if (tail.join("/") !== RESOURCES_DAEMON_BIN.join("/")) return null;
  const appIdx = parts.length - RESOURCES_DAEMON_BIN.length - 1;
  const appName = parts[appIdx];
  if (!appName || !appName.endsWith(".app")) return null;
  return parts.slice(0, appIdx + 1).join(sep);
}

export interface BundleDaemonPaths {
  appRoot: string;
  nodeBin: string;
  daemonCjs: string;
}

/** Absolute paths to the bundled node + daemon entry, or null in a dev run. */
export function getBundledDaemonPaths(execPath: string = process.execPath): BundleDaemonPaths | null {
  const appRoot = getAppBundleRoot(execPath);
  if (!appRoot) return null;
  const base = [appRoot, "Contents", "Resources", "daemon"].join(sep);
  return {
    appRoot,
    nodeBin: [base, "bin", "node"].join(sep),
    daemonCjs: [base, "daemon.cjs"].join(sep),
  };
}

/** True when the app is running from a Gatekeeper translocation mount. */
export function isTranslocated(execPath: string = process.execPath): boolean {
  return execPath.includes("/AppTranslocation/");
}

export interface BundleInstallReadiness {
  /** Safe to persist a bundle path (launchd plist, recorded version)? */
  ok: boolean;
  /** "dev" (not bundled), "translocated", "outside_applications", or "ok". */
  state: "dev" | "translocated" | "outside_applications" | "ok";
  appRoot: string | null;
  reason?: string;
}

/**
 * Whether it is safe to bake this bundle's absolute paths into persistent state
 * (the launchd plist, the recorded install version). Refuses for translocated or
 * non-/Applications locations so we never persist a path that vanishes.
 */
export function getBundleInstallReadiness(execPath: string = process.execPath): BundleInstallReadiness {
  if (isTranslocated(execPath)) {
    return {
      ok: false,
      state: "translocated",
      appRoot: null,
      reason: "HiveMatrix is running from a temporary quarantine location. Move HiveMatrix.app to /Applications and reopen it.",
    };
  }
  const appRoot = getAppBundleRoot(execPath);
  if (!appRoot) {
    // Dev run (tsx) — not a packaged bundle. Callers decide whether to allow.
    return { ok: false, state: "dev", appRoot: null, reason: "Not running from a packaged app bundle (dev run)." };
  }
  if (!appRoot.startsWith(`${sep}Applications${sep}`)) {
    return {
      ok: false,
      state: "outside_applications",
      appRoot,
      reason: `HiveMatrix.app is at ${appRoot}. Move it to /Applications and reopen it so background services use a stable path.`,
    };
  }
  return { ok: true, state: "ok", appRoot };
}
