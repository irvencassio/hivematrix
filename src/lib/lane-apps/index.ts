import { accessSync, constants as fsConstants, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";

import { LANE_APPS, getLaneApp } from "./catalog";
import type { LaneAppDescriptor, LaneAppStatus, LaneAppVersion } from "./contracts";
import { parseInfoPlist } from "./plist";
import { resolveInstallTarget, type InstallTarget } from "./install-target";
import { compareVersions, resolveStatus } from "./status";
import { verifyLaneApp, type VerifyLaneAppResult } from "./verify";

export * from "./contracts";
export { LANE_APPS, getLaneApp } from "./catalog";
export { verifyLaneApp } from "./verify";

// Pinned fallback versions used when the dev build artifact is absent (e.g. a
// packaged daemon with no build/ tree). Verified on this machine 2026-06-26.
const PINNED_EXPECTED: Record<string, LaneAppVersion> = {
  "browser-lane": { short: "0.1.86", build: "2" },
  "terminal-lane": { short: "0.1.2", build: "3" },
};

const ARTIFACT_DIR: Record<string, string> = {
  "browser-lane": "build/browser-lane",
  "terminal-lane": "build/terminal-lane",
};

export interface LaneInstalledCopy {
  path: string;
  /** "applications" (/Applications) or "user" (~/Applications/HiveMatrix Lanes). */
  location: "applications" | "user";
  version: LaneAppVersion | null;
  buildId: string | null;
  /** The copy LaunchServices resolves the bundle id to. */
  active: boolean;
  /** Version ≥ expected AND build id matches when both are known. */
  current: boolean;
}

export interface LaneAppState {
  id: string;
  displayName: string;
  installed: LaneAppVersion | null;
  expected: LaneAppVersion;
  /** Build identity of the active copy / the bundled artifact, when known. */
  installedBuildId?: string | null;
  expectedBuildId?: string | null;
  /** The copy that would be used/launched (active), or the preferred target if none installed. */
  installPath: string;
  /** The active installed copy, or null when missing. */
  activePath: string | null;
  /** Where an install would write (always user-writable). */
  preferredPath: string;
  installedPaths: string[];
  /** Every detected copy with its version/build identity + active/current flags. */
  installedCopies: LaneInstalledCopy[];
  duplicated: boolean;
  /** The active copy exists but is not current (stale version or build id). */
  activeIsStale: boolean;
  /** The active /Applications copy is stale AND a current user copy is being shadowed by it. */
  shadowed: boolean;
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
  /** Build identity of the expected/bundled artifact, if available. */
  expectedBuildId?: string | null;
  /** Read a specific copy's version (defaults to readInstalled for the active path). */
  readVersionAt?: (path: string) => LaneAppVersion | null;
  /** Read a specific copy's build identity, if available. */
  readBuildId?: (path: string) => string | null;
  /** Optional verification result (signature/launch) folded into status. */
  verify?: Pick<VerifyLaneAppResult, "signatureOk" | "launchOk">;
}

export function getLaneAppState(descriptor: LaneAppDescriptor, deps: GetLaneAppStateDeps): LaneAppState {
  const target: InstallTarget = resolveInstallTarget(descriptor, { home: deps.home, exists: deps.exists });
  const installed = target.activePath ? deps.readInstalled(target.activePath) : null;

  const isCurrent = (version: LaneAppVersion | null, buildId: string | null): boolean => {
    if (!version) return false;
    if (compareVersions(version, deps.expected) < 0) return false;
    if (buildId && deps.expectedBuildId && buildId !== deps.expectedBuildId) return false;
    return true;
  };

  const installedCopies: LaneInstalledCopy[] = target.installedPaths.map((path) => {
    const location: "applications" | "user" = path === target.applicationsPath ? "applications" : "user";
    const version = path === target.activePath ? installed : (deps.readVersionAt?.(path) ?? null);
    const buildId = deps.readBuildId?.(path) ?? null;
    return { path, location, version, buildId, active: path === target.activePath, current: isCurrent(version, buildId) };
  });

  const activeCopy = installedCopies.find((c) => c.active) ?? null;
  const userCopy = installedCopies.find((c) => c.location === "user") ?? null;

  let status = resolveStatus({
    installed,
    expected: deps.expected,
    installedBuildId: activeCopy?.buildId ?? null,
    expectedBuildId: deps.expectedBuildId ?? null,
    signatureOk: deps.verify?.signatureOk,
    launchOk: deps.verify?.launchOk ?? undefined,
  });

  const activeIsStale = !!activeCopy && !activeCopy.current
    && status !== "missing" && status !== "invalid_signature" && status !== "launch_failed";
  // The good user copy is shadowed when the active /Applications copy is stale.
  const shadowed = !!activeCopy && activeCopy.location === "applications" && !activeCopy.current && !!userCopy?.current;
  if (shadowed) status = "stale_copy";

  return {
    id: descriptor.id,
    displayName: descriptor.displayName,
    installed,
    expected: deps.expected,
    installedBuildId: activeCopy?.buildId ?? null,
    expectedBuildId: deps.expectedBuildId ?? null,
    installPath: target.activePath ?? target.preferredPath,
    activePath: target.activePath,
    preferredPath: target.preferredPath,
    installedPaths: target.installedPaths,
    installedCopies,
    duplicated: target.duplicated,
    activeIsStale,
    shadowed,
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

function readBundleInfo(appPath: string): { version: LaneAppVersion | null; buildId: string | null } {
  try {
    const xml = readFileSync(`${appPath}/Contents/Info.plist`, "utf8");
    const parsed = parseInfoPlist(xml);
    const version = parsed.short && parsed.build ? { short: parsed.short, build: parsed.build } : null;
    return { version, buildId: parsed.buildId };
  } catch {
    return { version: null, buildId: null };
  }
}

function readBundleVersion(appPath: string): LaneAppVersion | null {
  return readBundleInfo(appPath).version;
}

function readBundleBuildId(appPath: string): string | null {
  return readBundleInfo(appPath).buildId;
}

export function expectedVersionFor(descriptor: LaneAppDescriptor): LaneAppVersion {
  const fromArtifact = readBundleVersion(artifactPathFor(descriptor));
  return fromArtifact ?? PINNED_EXPECTED[descriptor.id];
}

export function expectedBuildIdFor(descriptor: LaneAppDescriptor): string | null {
  return readBundleBuildId(artifactPathFor(descriptor));
}

// Shared deps for reading per-copy version + build identity from real bundles.
function realReadDeps(descriptor: LaneAppDescriptor) {
  return {
    expected: expectedVersionFor(descriptor),
    expectedBuildId: expectedBuildIdFor(descriptor),
    readInstalled: (activePath: string | null) => (activePath ? readBundleVersion(activePath) : null),
    readVersionAt: (path: string) => readBundleVersion(path),
    readBuildId: (path: string) => readBundleBuildId(path),
  };
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
      ...realReadDeps(descriptor),
      expected,
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
    ...realReadDeps(descriptor),
    verify,
  });
  return { state, verification };
}

export async function installLaneAppById(id: string): Promise<{ state: LaneAppState; installedPath: string; activePath: string | null; shadowed: boolean; warning?: string }> {
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
  const state = getLaneAppState(descriptor, { home, exists: existsSync, ...realReadDeps(descriptor) });
  // If we wrote the user copy but LaunchServices will still launch a different
  // (stale /Applications) copy, say so — never report a clean install.
  const shadowed = state.shadowed || (!!state.activePath && state.activePath !== installedPath);
  const warning = shadowed
    ? `Installed to ${installedPath}, but macOS will still launch the copy at ${state.activePath}. Use “Update /Applications copy” to replace the stale copy.`
    : undefined;
  return { state, installedPath, activePath: state.activePath, shadowed, warning };
}

export interface RepairApplicationsResult { ok: boolean; replacedPath?: string; instructions?: string }

export interface RepairApplicationsDeps {
  home: string;
  artifactPath: string;
  exists: (path: string) => boolean;
  writable: (path: string) => boolean;
  replace: (from: string, to: string) => void;
}

// Pure core: replace a writable stale /Applications copy with the bundled
// artifact, else return exact instructions. Never sudo, never an arbitrary path.
export function repairApplicationsCopyWith(descriptor: LaneAppDescriptor, deps: RepairApplicationsDeps): RepairApplicationsResult {
  const target = resolveInstallTarget(descriptor, { home: deps.home, exists: deps.exists });
  const appsPath = target.applicationsPath;
  if (!deps.exists(appsPath)) {
    return { ok: false, instructions: `No /Applications copy at ${appsPath}. Use Install/Update instead.` };
  }
  if (!deps.exists(deps.artifactPath)) {
    return { ok: false, instructions: `Bundled artifact not found (${deps.artifactPath}). Reinstall HiveMatrix, then retry.` };
  }
  if (!deps.writable(appsPath)) {
    return {
      ok: false,
      instructions: `${appsPath} is not writable by your user. Quit ${descriptor.displayName}, drag it to the Trash (admin rights may be required), then click Install/Update — or replace it manually from ${deps.artifactPath}.`,
    };
  }
  deps.replace(deps.artifactPath, appsPath);
  return { ok: true, replacedPath: appsPath };
}

export async function repairApplicationsCopy(id: string): Promise<RepairApplicationsResult> {
  const descriptor = getLaneApp(id as LaneAppDescriptor["id"]);
  return repairApplicationsCopyWith(descriptor, {
    home: homedir(),
    artifactPath: artifactPathFor(descriptor),
    exists: existsSync,
    writable: (path) => { try { accessSync(path, fsConstants.W_OK); return true; } catch { return false; } },
    replace: (from, to) => {
      const staging = `${to}.installing`;
      rmSync(staging, { recursive: true, force: true });
      cpSync(from, staging, { recursive: true });
      rmSync(to, { recursive: true, force: true });
      renameSync(staging, to);
    },
  });
}

export function activePathFor(id: string): string | null {
  const descriptor = getLaneApp(id as LaneAppDescriptor["id"]);
  return resolveInstallTarget(descriptor, { home: homedir(), exists: existsSync }).activePath;
}

// --- Update all stale lane apps (post main-app update) ----------------------

interface UpdateAllStateLike {
  id: string;
  displayName: string;
  status: string; // LaneAppStatus at runtime; widened so injected stubs/states fit
  shadowed?: boolean;
  activePath?: string | null;
}

export interface LaneUpdateResult {
  id: string;
  displayName: string;
  updated: boolean;
  installedPath?: string;
  activePath?: string | null;
  replacedApplications?: string;
  shadowed: boolean;
  warning?: string;
}

export interface UpdateAllStaleLaneAppsDeps {
  getStates: () => Promise<UpdateAllStateLike[]>;
  install: (id: string) => Promise<{ installedPath: string; activePath: string | null; shadowed: boolean; warning?: string }>;
  repair: (id: string) => Promise<RepairApplicationsResult>;
}

/** A lane needs the bundled app to replace its active copy. */
function laneIsStale(s: UpdateAllStateLike): boolean {
  return s.status === "update_available" || s.status === "stale_copy" || !!s.shadowed;
}

/**
 * Install/update every stale lane app from the bundled artifacts, and — when a
 * stale /Applications copy is still active and writable — replace it so the fresh
 * build actually launches. Reports exactly which path changed and never leaves a
 * silently-shadowed user copy (a remaining shadow is surfaced with instructions).
 */
export async function updateAllStaleLaneApps(deps: UpdateAllStaleLaneAppsDeps = defaultUpdateAllDeps()): Promise<{ ok: boolean; results: LaneUpdateResult[] }> {
  const states = await deps.getStates();
  const results: LaneUpdateResult[] = [];
  for (const s of states) {
    if (!laneIsStale(s)) continue;
    const out: LaneUpdateResult = { id: s.id, displayName: s.displayName, updated: false, shadowed: false };
    const installed = await deps.install(s.id);
    out.installedPath = installed.installedPath;
    out.activePath = installed.activePath;
    out.updated = true;
    if (installed.shadowed) {
      // The active /Applications copy still wins — try to replace it.
      const rep = await deps.repair(s.id);
      if (rep.ok) {
        out.replacedApplications = rep.replacedPath;
        out.shadowed = false;
      } else {
        out.shadowed = true;
        out.warning = rep.instructions ?? installed.warning;
      }
    }
    results.push(out);
  }
  // Not-ok if any stale copy remains active (so the UI keeps flagging it).
  const ok = results.every((r) => !r.shadowed);
  return { ok, results };
}

function defaultUpdateAllDeps(): UpdateAllStaleLaneAppsDeps {
  return {
    getStates: async () => (await getAllLaneAppStates()).map((s) => ({ id: s.id, displayName: s.displayName, status: s.status, shadowed: s.shadowed, activePath: s.activePath })),
    install: async (id) => {
      const r = await installLaneAppById(id);
      return { installedPath: r.installedPath, activePath: r.activePath, shadowed: r.shadowed, warning: r.warning };
    },
    repair: (id) => repairApplicationsCopy(id),
  };
}
