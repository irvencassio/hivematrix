/**
 * Local-posture report (W3.2). Makes the 100%-local story honest and VISIBLE:
 * for the current connectivity mode, every capability has an explicit
 * disposition — works / degraded (local fallback) / queued (waits for the cloud)
 * — so cloud-needing work is never silently dropped. Surfaced to the console +
 * iOS so "Wi-Fi off" shows what's running, what degraded, and what's waiting.
 */

import { getConnectivityPolicy, type ConnectivityMode } from "./policy";
import { getLocalModelConfig } from "@/lib/config/constants";

export type Disposition = "works" | "degraded" | "queued";
export type DispositionAction = "run_now" | "use_local_fallback" | "wait_for_cloud";

export interface CapabilityPosture {
  id: string;
  label: string;
  disposition: Disposition;
  action: DispositionAction;
  note: string;
}

export interface PostureCounts {
  works: number;
  degraded: number;
  queued: number;
}

export interface LocalPostureReport {
  mode: ConnectivityMode;
  capabilities: CapabilityPosture[];
  counts: PostureCounts;
  /** True when no capability silently fails (always true by construction). */
  allHonest: boolean;
  summary: string;
}

export interface PostureReport {
  current: LocalPostureReport;
  modes: Record<ConnectivityMode, LocalPostureReport>;
}

const MODES: ConnectivityMode[] = ["cloud-ok", "local-only", "offline"];

function countsFor(capabilities: CapabilityPosture[]): PostureCounts {
  return {
    works: capabilities.filter((c) => c.disposition === "works").length,
    degraded: capabilities.filter((c) => c.disposition === "degraded").length,
    queued: capabilities.filter((c) => c.disposition === "queued").length,
  };
}

/** Pure: the disposition of every capability under a connectivity mode.
 * `hasLocalModel` — whether an opt-in bring-your-own local model is configured.
 * Post-Claude-native cutover there is no built-in local model, so the "Local
 * model" capability is only surfaced when the operator has configured one. */
export function describeLocalPosture(mode: ConnectivityMode, hasLocalModel = false): LocalPostureReport {
  const cloud = mode === "cloud-ok";
  const caps: CapabilityPosture[] = [
    ...(hasLocalModel
      ? [{ id: "local", label: "Local model", disposition: "works", action: "run_now", note: "Your configured bring-your-own local model runs in every mode." } as CapabilityPosture]
      : []),
    { id: "desktopbee", label: "Desktop Lane", disposition: "works", action: "run_now", note: "Native desktop control works offline." },
    {
      id: "coo-router",
      label: "COO routing",
      disposition: "works",
      action: "run_now",
      note: cloud
        ? "COO routing resolves requests and can create the routed Browser Lane task."
        : "COO routing works locally — requests resolve to a lane and a plan is prepared; lane execution may queue, degrade, or require approval (e.g. Browser Lane workflows wait for connectivity, never silently rerouted).",
    },
    {
      id: "frontier",
      label: "Frontier models",
      disposition: cloud ? "works" : "queued",
      action: cloud ? "run_now" : "wait_for_cloud",
      note: cloud ? "Frontier models reachable." : "Cloud/frontier work waits for connectivity — no silent local downgrade in cloud-only mode.",
    },
    {
      id: "webbee",
      label: "Browser Lane Read",
      disposition: cloud ? "works" : "queued",
      action: cloud ? "run_now" : "wait_for_cloud",
      note: cloud ? "Fresh web retrieval available." : "Fresh web retrieval waits for connectivity; dependent work is deferred, not failed.",
    },
    {
      id: "browserbee",
      label: "Browser Lane Workflow",
      disposition: cloud ? "works" : "queued",
      action: cloud ? "run_now" : "wait_for_cloud",
      note: cloud ? "Authenticated browser workflows available." : "Browser workflows wait for connectivity unless the operator has explicitly enabled a local Desktop Lane browser fallback.",
    },
    {
      id: "image",
      label: "Image generation",
      disposition: cloud ? "works" : "degraded",
      action: cloud ? "run_now" : "use_local_fallback",
      note: cloud ? "Nano Banana (nanai) image generation." : "Local mflux fallback (draft-grade) — no network needed.",
    },
    {
      id: "code-review-debt",
      label: "Frontier review debt",
      disposition: cloud ? "works" : "queued",
      action: cloud ? "run_now" : "wait_for_cloud",
      note: cloud ? "Code-critical runs on frontier." : "Code-critical runs locally now and is queued for a frontier review when cloud returns.",
    },
  ];
  const counts = countsFor(caps);
  const summary = cloud
    ? "All capabilities available (cloud-ok)."
    : `Running ${mode}: ${counts.works} working, ${counts.degraded} degraded (local fallback), ${counts.queued} queued for connectivity. Nothing silently fails.`;
  return { mode, capabilities: caps, counts, allHonest: true, summary };
}

export function describeAllPostures(currentMode: ConnectivityMode, hasLocalModel = false): PostureReport {
  const modes = Object.fromEntries(MODES.map((mode) => [mode, describeLocalPosture(mode, hasLocalModel)])) as Record<ConnectivityMode, LocalPostureReport>;
  return { current: modes[currentMode], modes };
}

/** True when the operator has configured an opt-in bring-your-own local model. */
function localModelConfigured(): boolean {
  return getLocalModelConfig() !== null;
}

export function getLocalPostureReport(): LocalPostureReport {
  return describeLocalPosture(getConnectivityPolicy().mode, localModelConfigured());
}

export function getPostureReport(): PostureReport {
  return describeAllPostures(getConnectivityPolicy().mode, localModelConfigured());
}
