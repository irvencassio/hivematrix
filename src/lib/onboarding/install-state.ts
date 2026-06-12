/**
 * Install state + the boot-mode decision (fresh / update / same).
 *
 * Evaluated at daemon startup BEFORE getDb() runs migrations, because getDb()
 * creates the DB on first connect — so "DB exists" can't distinguish a fresh
 * install from an installed one. We key off config + launchd presence and a
 * recorded installedVersion in ~/.hivematrix/state.json instead.
 *
 *   fresh  — no config and no launchd agent → first run, wizard drives setup.
 *   update — installed, and the bundled version is newer (or no version was
 *            ever recorded) → back up the DB, let migrations run, then probe.
 *   same   — installed at the current version → normal boot.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { compareVersions } from "@/lib/updater/manifest";

export type BootMode = "fresh" | "update" | "same";

export interface BootDecision {
  mode: BootMode;
  /** Previously recorded installed version (null on a clean machine). */
  from: string | null;
  /** The version this bundle reports. */
  to: string;
}

function hiveDir(): string { return join(homedir(), ".hivematrix"); }
function statePath(): string { return join(hiveDir(), "state.json"); }
function configPath(): string { return join(hiveDir(), "config.json"); }
function launchAgentPath(): string {
  return join(homedir(), "Library", "LaunchAgents", "com.hivematrix.daemon.plist");
}

export function getInstalledVersion(): string | null {
  try {
    const s = JSON.parse(readFileSync(statePath(), "utf-8")) as { installedVersion?: unknown };
    return typeof s.installedVersion === "string" ? s.installedVersion : null;
  } catch {
    return null;
  }
}

export function recordInstalledVersion(version: string): void {
  mkdirSync(hiveDir(), { recursive: true });
  let state: Record<string, unknown> = {};
  try { state = JSON.parse(readFileSync(statePath(), "utf-8")); } catch { /* new file */ }
  state.installedVersion = version;
  state.installedAt = state.installedAt ?? new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

/**
 * Pure decision — all inputs injected so it's unit-testable. `compare` returns
 * <0 when a<b (defaults to the manifest semver compare).
 */
export function decideBootMode(input: {
  hasConfig: boolean;
  hasLaunchAgent: boolean;
  installedVersion: string | null;
  bundledVersion: string;
  compare?: (a: string, b: string) => number;
}): BootDecision {
  const { hasConfig, hasLaunchAgent, installedVersion, bundledVersion } = input;
  const compare = input.compare ?? compareVersions;
  if (!hasConfig && !hasLaunchAgent) {
    return { mode: "fresh", from: installedVersion, to: bundledVersion };
  }
  // Installed. A missing recorded version means an upgrade from a pre-versioning
  // build — treat as update so migrations + a backup run.
  if (installedVersion == null) return { mode: "update", from: null, to: bundledVersion };
  return {
    mode: compare(installedVersion, bundledVersion) < 0 ? "update" : "same",
    from: installedVersion,
    to: bundledVersion,
  };
}

/** Decide the boot mode from the real filesystem state. */
export function planBoot(bundledVersion: string): BootDecision {
  return decideBootMode({
    hasConfig: existsSync(configPath()),
    hasLaunchAgent: existsSync(launchAgentPath()),
    installedVersion: getInstalledVersion(),
    bundledVersion,
  });
}
