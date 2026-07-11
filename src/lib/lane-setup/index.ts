/**
 * Lane Setup & Reliability Center — a unified, read-only model that composes the
 * existing lane-app install state with the Browser Lane readiness dashboard
 * so the operator sees one truth per Lane: bundled? installed? current?
 * signed/launchable? daemon reachable? readiness green? and the single next
 * action to click.
 *
 * It NEVER launches an app to compute state (launch is a read-only pgrep), NEVER
 * spawns codesign on a plain read (signing comes from the last operator-run
 * Verify), and NEVER includes per-site/per-profile detail — readiness is
 * counts-only, so no credential reference, host, or account ever enters here.
 */
import { spawnSync } from "node:child_process";

import { LANE_APPS, getLaneApp } from "@/lib/lane-apps/catalog";
import { getAllLaneAppStates, type LaneAppState } from "@/lib/lane-apps";
import { getBrowserLaneReadinessDashboard } from "@/lib/browser-lane/store";

export type LaneInstallState = "not_installed" | "current" | "outdated" | "stale" | "broken";
export type LaneLaunchState = "unknown" | "running" | "not_running" | "failed";
export type LaneSigningState = "unknown" | "valid" | "invalid";
export type LaneDaemonState = "reachable" | "unavailable";
export type LaneActionId = "install" | "update" | "verify" | "launch" | "run_readiness" | "open" | "repair";

export interface LaneVersion { short: string; build: string }

export interface LaneInstalledCopySummary {
  path: string;
  location: "applications" | "user";
  active: boolean;
  current: boolean;
}

export interface BrowserReadinessSummary {
  lane: "browser";
  configuredSites: number;
  ready: number;
  stale: number;
  needsAttention: number;
}

export interface LaneSetupEntry {
  id: string;
  displayName: string;
  bundledVersion: LaneVersion;
  installedVersion: LaneVersion | null;
  installedPath: string;
  installState: LaneInstallState;
  launchState: LaneLaunchState;
  signingState: LaneSigningState;
  daemonState: LaneDaemonState;
  readiness: BrowserReadinessSummary;
  nextAction: { action: LaneActionId; label: string };
  disabledReasons: Record<string, string>;
  /** Build identity (HMBuildId) of the active installed copy / the bundled artifact. */
  installedBuildId: string | null;
  bundledBuildId: string | null;
  /** The active copy is version-stale or shadowed → the bundled app should replace it. */
  needsUpdate: boolean;
  /** Every detected copy on disk (active/current flags) so the UI can list them. */
  installedCopies: LaneInstalledCopySummary[];
  /** A stale /Applications copy is shadowing a current user copy. */
  shadowed: boolean;
  /** The active copy exists but is not current. */
  activeIsStale: boolean;
}

export interface LaneUpdateSummary {
  /** Display names of the Lane apps that need updating after a main-app update. */
  needsUpdate: string[];
  count: number;
  /** Any stale copy is the active /Applications copy (a silent shadow risk). */
  anyShadowed: boolean;
}

export interface LaneSetup { lanes: LaneSetupEntry[]; updateSummary: LaneUpdateSummary }

interface LaneVerificationRecord { signatureOk?: boolean; launchOk?: boolean | null }

// In-memory, per-process cache of the last operator-run Verify per lane app.
// Cleared on daemon restart → signingState honestly reads "unknown" until the
// operator verifies again. No secrets, just booleans + a timestamp-free flag.
const verificationCache = new Map<string, LaneVerificationRecord>();

export function recordLaneVerification(id: string, record: LaneVerificationRecord | null | undefined): void {
  if (!record) return;
  verificationCache.set(id, { signatureOk: record.signatureOk, launchOk: record.launchOk ?? null });
}
export function getLaneVerification(id: string): LaneVerificationRecord | null {
  return verificationCache.get(id) ?? null;
}

// Read-only liveness probe. Uses the FIXED catalog executable name (never user
// input) so there is no injection surface, and it never launches the app.
function defaultIsRunning(executable: string): boolean | null {
  try {
    const r = spawnSync("pgrep", ["-x", executable], { timeout: 4000 });
    if (r.error || typeof r.status !== "number") return null;
    return r.status === 0;
  } catch {
    return null;
  }
}

export interface LaneSetupDeps {
  appStates?: () => Promise<LaneAppState[]> | LaneAppState[];
  browserDashboard?: () => { totals: { sites: number; byColor: Record<string, number>; needsAttention: number; stale: number } };
  isRunning?: (executable: string) => boolean | null;
  verification?: (id: string) => LaneVerificationRecord | null;
}

function installStateFor(status: LaneAppState["status"]): LaneInstallState {
  switch (status) {
    case "missing": return "not_installed";
    case "update_available": return "outdated";
    case "stale_copy": return "stale";
    case "launch_failed":
    case "invalid_signature": return "broken";
    default: return "current"; // "installed"
  }
}

function pickNextAction(args: {
  installState: LaneInstallState;
  signingState: LaneSigningState;
  launchState: LaneLaunchState;
  needsAttention: number;
  activeInApplications: boolean;
}): { action: LaneActionId; label: string } {
  const { installState, signingState, launchState, needsAttention, activeInApplications } = args;
  if (installState === "not_installed") return { action: "install", label: "Install" };
  if (installState === "outdated") return { action: "update", label: "Update" };
  // A stale active copy: if it's the /Applications copy, installing a user copy
  // would just be shadowed — point the operator at replacing the active copy.
  if (installState === "stale") {
    return activeInApplications
      ? { action: "repair", label: "Update /Applications copy" }
      : { action: "update", label: "Update" };
  }
  if (installState === "broken") return { action: "verify", label: "Verify" };
  if (signingState === "unknown") return { action: "verify", label: "Verify" };
  if (launchState !== "running") return { action: "launch", label: "Launch" };
  if (needsAttention > 0) return { action: "run_readiness", label: "Run readiness" };
  return { action: "open", label: "Open app" };
}

function summarizeBrowser(dash: ReturnType<NonNullable<LaneSetupDeps["browserDashboard"]>>): BrowserReadinessSummary {
  const t = dash.totals;
  return { lane: "browser", configuredSites: t.sites || 0, ready: (t.byColor?.green) || 0, stale: t.stale || 0, needsAttention: t.needsAttention || 0 };
}

export async function getLaneSetup(deps: LaneSetupDeps = {}): Promise<LaneSetup> {
  const appStates = await (deps.appStates ? deps.appStates() : getAllLaneAppStates());
  const isRunning = deps.isRunning ?? defaultIsRunning;
  const verification = deps.verification ?? getLaneVerification;
  const browserDashboard = deps.browserDashboard ?? (() => getBrowserLaneReadinessDashboard());

  const lanes: LaneSetupEntry[] = LANE_APPS.map((descriptor) => {
    const state = appStates.find((s) => s.id === descriptor.id);
    const installState: LaneInstallState = state ? installStateFor(state.status) : "not_installed";
    const installedVersion = state?.installed ?? null;
    const bundledVersion = state?.expected ?? { short: "0.0.0", build: "0" };
    const installedPath = state?.activePath ?? state?.preferredPath ?? state?.installPath ?? "";

    const ver = verification(descriptor.id);
    const running = isRunning(descriptor.executable);
    const launchState: LaneLaunchState = ver?.launchOk === false ? "failed"
      : running === true ? "running"
      : running === false ? "not_running"
      : "unknown";
    const signingState: LaneSigningState = ver?.signatureOk === true ? "valid"
      : ver?.signatureOk === false ? "invalid"
      : "unknown";

    let daemonState: LaneDaemonState = "reachable";
    let readiness: BrowserReadinessSummary;
    try {
      readiness = summarizeBrowser(browserDashboard());
    } catch {
      daemonState = "unavailable";
      readiness = { lane: "browser", configuredSites: 0, ready: 0, stale: 0, needsAttention: 0 };
    }

    const installedCopies: LaneInstalledCopySummary[] = (state?.installedCopies ?? []).map((c) => ({
      path: c.path, location: c.location, active: c.active, current: c.current,
    }));
    const shadowed = !!state?.shadowed;
    const activeIsStale = !!state?.activeIsStale;
    const activeInApplications = installedCopies.some((c) => c.active && c.location === "applications");

    const nextAction = pickNextAction({ installState, signingState, launchState, needsAttention: readiness.needsAttention, activeInApplications });

    const disabledReasons: Record<string, string> = {};
    if (installState === "not_installed") {
      disabledReasons.verify = "Install the app first.";
      disabledReasons.launch = "Install the app first.";
      disabledReasons.reveal = "Install the app first.";
    }

    // "needs update" = the bundled app should replace the active copy: a
    // version-stale active copy, or a stale /Applications copy shadowing a fresh
    // user copy. (broken → Verify, not_installed → Install — handled separately.)
    const needsUpdate = installState === "outdated" || installState === "stale" || shadowed;

    return {
      id: descriptor.id,
      displayName: descriptor.displayName,
      bundledVersion,
      installedVersion,
      installedPath,
      installState,
      launchState,
      signingState,
      daemonState,
      readiness,
      nextAction,
      disabledReasons,
      installedBuildId: state?.installedBuildId ?? null,
      bundledBuildId: state?.expectedBuildId ?? null,
      needsUpdate,
      installedCopies,
      shadowed,
      activeIsStale,
    };
  });

  const stale = lanes.filter((l) => l.needsUpdate);
  const updateSummary: LaneUpdateSummary = {
    needsUpdate: stale.map((l) => l.displayName),
    count: stale.length,
    anyShadowed: stale.some((l) => l.shadowed),
  };

  return { lanes, updateSummary };
}

// Re-export the catalog accessor so callers can resolve executables/ids safely.
export { LANE_APPS, getLaneApp };
