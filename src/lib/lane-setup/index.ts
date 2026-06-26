/**
 * Lane Setup & Reliability Center — a unified, read-only model that composes the
 * existing lane-app install state with the Browser/Terminal readiness dashboards
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
import { getTerminalLaneReadinessDashboard } from "@/lib/terminal-lane/store";

export type LaneInstallState = "not_installed" | "current" | "outdated" | "broken";
export type LaneLaunchState = "unknown" | "running" | "not_running" | "failed";
export type LaneSigningState = "unknown" | "valid" | "invalid";
export type LaneDaemonState = "reachable" | "unavailable";
export type LaneActionId = "install" | "update" | "verify" | "launch" | "run_readiness" | "open";

export interface LaneVersion { short: string; build: string }

export interface BrowserReadinessSummary {
  lane: "browser";
  configuredSites: number;
  ready: number;
  stale: number;
  needsAttention: number;
}
export interface TerminalReadinessSummary {
  lane: "terminal";
  configuredProfiles: number;
  ready: number;
  failed: number;
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
  readiness: BrowserReadinessSummary | TerminalReadinessSummary;
  nextAction: { action: LaneActionId; label: string };
  disabledReasons: Record<string, string>;
}

export interface LaneSetup { lanes: LaneSetupEntry[] }

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
  terminalDashboard?: () => { totals: { profiles: number; byColor: Record<string, number>; needsAttention: number } };
  isRunning?: (executable: string) => boolean | null;
  verification?: (id: string) => LaneVerificationRecord | null;
}

function installStateFor(status: LaneAppState["status"]): LaneInstallState {
  switch (status) {
    case "missing": return "not_installed";
    case "update_available": return "outdated";
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
}): { action: LaneActionId; label: string } {
  const { installState, signingState, launchState, needsAttention } = args;
  if (installState === "not_installed") return { action: "install", label: "Install" };
  if (installState === "outdated") return { action: "update", label: "Update" };
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
function summarizeTerminal(dash: ReturnType<NonNullable<LaneSetupDeps["terminalDashboard"]>>): TerminalReadinessSummary {
  const t = dash.totals;
  const c = t.byColor || {};
  return { lane: "terminal", configuredProfiles: t.profiles || 0, ready: c.green || 0, failed: (c.yellow || 0) + (c.orange || 0) + (c.red || 0), needsAttention: t.needsAttention || 0 };
}

export async function getLaneSetup(deps: LaneSetupDeps = {}): Promise<LaneSetup> {
  const appStates = await (deps.appStates ? deps.appStates() : getAllLaneAppStates());
  const isRunning = deps.isRunning ?? defaultIsRunning;
  const verification = deps.verification ?? getLaneVerification;
  const browserDashboard = deps.browserDashboard ?? (() => getBrowserLaneReadinessDashboard());
  const terminalDashboard = deps.terminalDashboard ?? (() => getTerminalLaneReadinessDashboard());

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
    let readiness: BrowserReadinessSummary | TerminalReadinessSummary;
    try {
      readiness = descriptor.id === "browser-lane"
        ? summarizeBrowser(browserDashboard())
        : summarizeTerminal(terminalDashboard());
    } catch {
      daemonState = "unavailable";
      readiness = descriptor.id === "browser-lane"
        ? { lane: "browser", configuredSites: 0, ready: 0, stale: 0, needsAttention: 0 }
        : { lane: "terminal", configuredProfiles: 0, ready: 0, failed: 0, needsAttention: 0 };
    }

    const nextAction = pickNextAction({ installState, signingState, launchState, needsAttention: readiness.needsAttention });

    const disabledReasons: Record<string, string> = {};
    if (installState === "not_installed") {
      disabledReasons.verify = "Install the app first.";
      disabledReasons.launch = "Install the app first.";
      disabledReasons.reveal = "Install the app first.";
    }

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
    };
  });

  return { lanes };
}

// Re-export the catalog accessor so callers can resolve executables/ids safely.
export { LANE_APPS, getLaneApp };
