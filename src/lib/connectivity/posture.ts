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

/**
 * What KIND of thing an entry is. These were previously all rendered as one
 * flat list beside the Agents sidebar, which made "Browser Lane Read" look like
 * a sibling of "Browser Lane" and left no way to explain why "Frontier review
 * debt" is not an agent.
 *
 *   capability — something the system can do, which degrades by mode.
 *   policy     — a RULE about what happens under degradation. There is no
 *                process to be up; nothing to start or stop.
 */
export type PostureCategory = "capability" | "policy";

export interface CapabilityPosture {
  id: string;
  /** Full standalone name, e.g. "Browser Lane Read". */
  label: string;
  /**
   * Name WITHIN its owning lane, e.g. "Read". Used when rendering nested under
   * a lane heading so the lane name is not repeated on every row. Absent when
   * the entry has no owning lane.
   */
  shortLabel?: string;
  /** Owning lane id, when this is a capability OF a specific lane. */
  lane?: string;
  category: PostureCategory;
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

/** Counts describe CAPABILITIES only. A policy is a rule about what happens
 *  under degradation — it is not a capability that "works", and counting it as
 *  one made the summary claim "All capabilities available … (7 works)" when
 *  only 6 of those 7 entries were capabilities. */
function countsFor(entries: CapabilityPosture[]): PostureCounts {
  const capabilities = entries.filter((c) => c.category !== "policy");
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
      ? [{ id: "local", label: "Local model", category: "capability", disposition: "works", action: "run_now", note: "Your configured bring-your-own local model runs in every mode." } as CapabilityPosture]
      : []),
    {
      id: "mailbee",
      label: "Mail Lane",
      shortLabel: "Read + compose",
      lane: "mail",
      category: "capability",
      // applemail.ts: "self-contained (no IMAP/SMTP, no OAuth)" — osascript
      // against Mail.app, so the lane itself never touches the network.
      disposition: "works",
      action: "run_now",
      note: cloud
        ? "Reads and composes through Mail.app — no IMAP/SMTP or OAuth of its own."
        : "Runs entirely through Mail.app on this machine; queued mail leaves the Outbox when the network returns.",
    },
    {
      id: "messagebee",
      label: "Message Lane",
      shortLabel: "Read + send",
      lane: "message",
      category: "capability",
      // imessage.ts: reads chat.db directly, sends via osascript to Messages.app.
      disposition: "works",
      action: "run_now",
      note: cloud
        ? "Reads chat.db and sends through Messages.app."
        : "Reads chat.db locally and hands sends to Messages.app, which delivers them when the network returns.",
    },
    {
      id: "brainbee",
      label: "Memory Lane",
      shortLabel: "Recall",
      lane: "memory",
      category: "capability",
      // embeddings/provider.ts is local-first and self-gating: it returns null
      // on any error so callers fall back to keyword retrieval.
      disposition: "works",
      action: "run_now",
      note: cloud
        ? "Brain retrieval with local-first embeddings — no doc content leaves the box."
        : "Embeddings are local-first, so recall keeps working; if the embedder is unavailable it falls back to keyword search.",
    },
    {
      id: "review",
      label: "Review Lane",
      shortLabel: "Review",
      lane: "review",
      category: "capability",
      // Planning/review need a text model, and after the Claude-native cutover
      // every text role is "unavailable" without cloud (connectivity/policy.ts).
      disposition: cloud ? "works" : "queued",
      action: cloud ? "run_now" : "wait_for_cloud",
      note: cloud
        ? "Planning, routing and review run on frontier."
        : "Routing and diagnostics still resolve locally, but planning and review need a frontier model and wait for connectivity.",
    },
    { id: "desktopbee", label: "Desktop control", shortLabel: "Control", lane: "desktop", category: "capability", disposition: "works", action: "run_now", note: "Native desktop control works offline." },
    {
      id: "coo-router",
      label: "COO routing",
      category: "capability",
      disposition: "works",
      action: "run_now",
      note: cloud
        ? "COO routing resolves requests and can create the routed Browser Lane task."
        : "COO routing works locally — requests resolve to a lane and a plan is prepared; lane execution may queue, degrade, or require approval (e.g. Browser Lane workflows wait for connectivity, never silently rerouted).",
    },
    {
      id: "frontier",
      label: "Frontier models",
      category: "capability",
      disposition: cloud ? "works" : "queued",
      action: cloud ? "run_now" : "wait_for_cloud",
      note: cloud ? "Frontier models reachable." : "Cloud/frontier work waits for connectivity — no silent local downgrade in cloud-only mode.",
    },
    {
      id: "webbee",
      label: "Browser Lane Read",
      shortLabel: "Read",
      lane: "browser",
      category: "capability",
      disposition: cloud ? "works" : "queued",
      action: cloud ? "run_now" : "wait_for_cloud",
      note: cloud ? "Fresh web retrieval available." : "Fresh web retrieval waits for connectivity; dependent work is deferred, not failed.",
    },
    {
      id: "browserbee",
      label: "Browser Lane Workflow",
      shortLabel: "Workflow",
      lane: "browser",
      category: "capability",
      disposition: cloud ? "works" : "queued",
      action: cloud ? "run_now" : "wait_for_cloud",
      note: cloud ? "Authenticated browser workflows available." : "Browser workflows wait for connectivity unless the operator has explicitly enabled a local Desktop Lane browser fallback.",
    },
    {
      id: "image",
      label: "Image generation",
      category: "capability",
      disposition: cloud ? "works" : "degraded",
      action: cloud ? "run_now" : "use_local_fallback",
      note: cloud ? "Nano Banana (nanai) image generation." : "Local mflux fallback (draft-grade) — no network needed.",
    },
    {
      id: "code-review-debt",
      label: "Frontier review debt",
      // Not a surface and not a capability: a rule about what happens when the
      // cloud is unreachable. There is nothing here to be "running", which is
      // why it never belonged in the Agents list.
      category: "policy",
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
