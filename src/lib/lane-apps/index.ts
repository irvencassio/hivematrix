import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";

import { LANE_APPS, getLaneApp } from "./catalog";
import type { LaneAppDescriptor, LaneAppStatus, LaneAppVersion } from "./contracts";
import { parseInfoPlist } from "./plist";
import { resolveInstallTarget, type InstallTarget } from "./install-target";
import { resolveStatus } from "./status";
import { verifyLaneApp, type VerifyLaneAppResult } from "./verify";

export * from "./contracts";
export { LANE_APPS, getLaneApp } from "./catalog";
export { verifyLaneApp } from "./verify";

// Pinned fallback versions used when the dev build artifact is absent (e.g. a
// packaged daemon with no build/ tree). Verified on this machine 2026-06-26.
const PINNED_EXPECTED: Record<string, LaneAppVersion> = {
  "browser-lane": { short: "0.1.86", build: "2" },
  "terminal-lane": { short: "0.1.1", build: "2" },
};

const ARTIFACT_DIR: Record<string, string> = {
  "browser-lane": "build/browser-lane",
  "terminal-lane": "build/terminal-lane",
};

export interface LaneAppState {
  id: string;
  displayName: string;
  installed: LaneAppVersion | null;
  expected: LaneAppVersion;
  /** The copy that would be used/launched (active), or the preferred target if none installed. */
  installPath: string;
  /** The active installed copy, or null when missing. */
  activePath: string | null;
  /** Where an install would write (always user-writable). */
  preferredPath: string;
  installedPaths: string[];
  duplicated: boolean;
  status: LaneAppStatus;
  signatureOk?: boolean;
  launchOk?: boolean | null;
}

export interface GetLaneAppStateDeps {
  home: string;
  exists: (path: string) => boolean;
  expected: LaneAppVersion;
  /** Read the installed version from the active bundle, or null if unreadable. */
  readInstalled: (activePath: string | null) => LaneAppVersion | null;
  /** Optional verification result (signature/launch) folded into status. */
  verify?: Pick<VerifyLaneAppResult, "signatureOk" | "launchOk">;
}

export function getLaneAppState(descriptor: LaneAppDescriptor, deps: GetLaneAppStateDeps): LaneAppState {
  const target: InstallTarget = resolveInstallTarget(descriptor, { home: deps.home, exists: deps.exists });
  const installed = target.activePath ? deps.readInstalled(target.activePath) : null;
  const status = resolveStatus({
    installed,
    expected: deps.expected,
    signatureOk: deps.verify?.signatureOk,
    launchOk: deps.verify?.launchOk ?? undefined,
  });
  return {
    id: descriptor.id,
    displayName: descriptor.displayName,
    installed,
    expected: deps.expected,
    installPath: target.activePath ?? target.preferredPath,
    activePath: target.activePath,
    preferredPath: target.preferredPath,
    installedPaths: target.installedPaths,
    duplicated: target.duplicated,
    status,
    ...(deps.verify ? { signatureOk: deps.verify.signatureOk, launchOk: deps.verify.launchOk } : {}),
  };
}

export interface InstallLaneAppDeps {
  artifactPath: string;
  home: string;
  exists: (path: string) => boolean;
  mkdirp: (dir: string) => void;
  /** Copy a bundle tree from → to. */
  copyTree: (from: string, to: string) => void;
  /** Atomic rename from staging → final. */
  rename: (from: string, to: string) => void;
}

export interface InstallLaneAppResult {
  installedPath: string;
}

// Install/update a lane app into the user-writable target by staging a copy
// beside the destination, then atomically renaming it into place. No sudo, no
// admin prompt, and never targets /Applications in MVP.
export async function installLaneApp(
  descriptor: LaneAppDescriptor,
  deps: InstallLaneAppDeps,
): Promise<InstallLaneAppResult> {
  if (!deps.exists(deps.artifactPath)) {
    throw new Error(`Lane app artifact not found: ${deps.artifactPath}`);
  }
  const target = resolveInstallTarget(descriptor, { home: deps.home, exists: deps.exists });
  const finalPath = target.preferredPath;
  const dir = finalPath.slice(0, finalPath.lastIndexOf("/"));
  const staging = `${finalPath}.installing`;

  deps.mkdirp(dir);
  deps.copyTree(deps.artifactPath, staging);
  deps.rename(staging, finalPath);
  return { installedPath: finalPath };
}

// --- Runtime helpers (default deps backed by the real filesystem) ----------

export interface ArtifactPathDeps {
  cwd?: string;
  execPath?: string;
  exists?: (path: string) => boolean;
  candidates?: string[];
}

const PACKAGED_DAEMON_NODE_MARKER = "/Contents/Resources/daemon/bin/node";
const PACKAGED_LANE_APP_MARKER = "/Contents/Resources/lane-apps";

export function artifactPathCandidatesFor(descriptor: LaneAppDescriptor, deps: ArtifactPathDeps = {}): string[] {
  const bundleName = `${descriptor.displayName}.app`;
  const cwd = deps.cwd ?? process.cwd();
  const execPath = deps.execPath ?? process.execPath;
  const candidates: string[] = [];

  if (execPath.endsWith(PACKAGED_DAEMON_NODE_MARKER)) {
    const appRoot = execPath.slice(0, -PACKAGED_DAEMON_NODE_MARKER.length);
    candidates.push(`${appRoot}${PACKAGED_LANE_APP_MARKER}/${bundleName}`);
  }

  candidates.push(`${cwd}/${ARTIFACT_DIR[descriptor.id]}/${bundleName}`);
  return Array.from(new Set(candidates));
}

export function artifactPathFor(descriptor: LaneAppDescriptor, deps: ArtifactPathDeps = {}): string {
  const candidates = deps.candidates ?? artifactPathCandidatesFor(descriptor, deps);
  const exists = deps.exists ?? existsSync;
  return candidates.find((candidate) => exists(candidate)) ?? candidates[0];
}

function readBundleVersion(appPath: string): LaneAppVersion | null {
  try {
    const xml = readFileSync(`${appPath}/Contents/Info.plist`, "utf8");
    const parsed = parseInfoPlist(xml);
    if (!parsed.short || !parsed.build) return null;
    return { short: parsed.short, build: parsed.build };
  } catch {
    return null;
  }
}

export function expectedVersionFor(descriptor: LaneAppDescriptor): LaneAppVersion {
  const fromArtifact = readBundleVersion(artifactPathFor(descriptor));
  return fromArtifact ?? PINNED_EXPECTED[descriptor.id];
}

export interface GetAllLaneAppStatesOptions {
  /** Run signature/launch verification on the active copy of each app. */
  verify?: boolean;
}

export async function getAllLaneAppStates(options: GetAllLaneAppStatesOptions = {}): Promise<LaneAppState[]> {
  const home = homedir();
  const states: LaneAppState[] = [];
  for (const descriptor of LANE_APPS) {
    const expected = expectedVersionFor(descriptor);
    let verify: Pick<VerifyLaneAppResult, "signatureOk" | "launchOk"> | undefined;
    const target = resolveInstallTarget(descriptor, { home, exists: existsSync });
    if (options.verify && target.activePath) {
      const result = await verifyLaneApp({ appPath: target.activePath, executable: descriptor.executable, launchProbe: true });
      verify = { signatureOk: result.signatureOk, launchOk: result.launchOk };
    }
    states.push(getLaneAppState(descriptor, {
      home,
      exists: existsSync,
      expected,
      readInstalled: (activePath) => (activePath ? readBundleVersion(activePath) : null),
      verify,
    }));
  }
  return states;
}

export async function verifyLaneAppById(id: string): Promise<{ state: LaneAppState; verification: VerifyLaneAppResult | null }> {
  const descriptor = getLaneApp(id as LaneAppDescriptor["id"]);
  const home = homedir();
  const target = resolveInstallTarget(descriptor, { home, exists: existsSync });
  let verification: VerifyLaneAppResult | null = null;
  let verify: Pick<VerifyLaneAppResult, "signatureOk" | "launchOk"> | undefined;
  if (target.activePath) {
    verification = await verifyLaneApp({ appPath: target.activePath, executable: descriptor.executable, launchProbe: true });
    verify = { signatureOk: verification.signatureOk, launchOk: verification.launchOk };
  }
  const state = getLaneAppState(descriptor, {
    home,
    exists: existsSync,
    expected: expectedVersionFor(descriptor),
    readInstalled: (activePath) => (activePath ? readBundleVersion(activePath) : null),
    verify,
  });
  return { state, verification };
}

export async function installLaneAppById(id: string): Promise<{ state: LaneAppState; installedPath: string }> {
  const descriptor = getLaneApp(id as LaneAppDescriptor["id"]);
  const { installedPath } = await installLaneApp(descriptor, {
    artifactPath: artifactPathFor(descriptor),
    home: homedir(),
    exists: existsSync,
    mkdirp: (dir) => mkdirSync(dir, { recursive: true }),
    copyTree: (from, to) => {
      rmSync(to, { recursive: true, force: true });
      cpSync(from, to, { recursive: true });
    },
    rename: (from, to) => {
      rmSync(to, { recursive: true, force: true });
      renameSync(from, to);
    },
  });
  const home = homedir();
  const state = getLaneAppState(descriptor, {
    home,
    exists: existsSync,
    expected: expectedVersionFor(descriptor),
    readInstalled: (activePath) => (activePath ? readBundleVersion(activePath) : null),
  });
  return { state, installedPath };
}

export function activePathFor(id: string): string | null {
  const descriptor = getLaneApp(id as LaneAppDescriptor["id"]);
  return resolveInstallTarget(descriptor, { home: homedir(), exists: existsSync }).activePath;
}
