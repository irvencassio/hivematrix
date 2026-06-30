/**
 * Review Lane heartbeat: recompute the control-plane report on an interval,
 * cache it for the status endpoint, and broadcast it so console/iOS clients
 * stay live. Embedded worker (runs in the daemon), same pattern as the
 * Message Lane/Mail Lane pollers — a guarded setInterval with an idempotent stop.
 */

import { broadcast } from "@/lib/ws/broadcaster";
import { buildManagerBeeReport, type ManagerBeeReport } from "./report";

const HEARTBEAT_INTERVAL_MS = 15_000;

let timer: ReturnType<typeof setInterval> | null = null;
let lastReport: ManagerBeeReport | null = null;

/** The cached report, or a freshly computed one if the heartbeat hasn't ticked. */
export function getReviewLaneStatus(): ManagerBeeReport {
  return lastReport ?? buildManagerBeeReport();
}

/** @deprecated Use getReviewLaneStatus. */
export function getManagerBeeStatus(): ManagerBeeReport {
  return lastReport ?? buildManagerBeeReport();
}

function tick(): void {
  try {
    lastReport = buildManagerBeeReport();
    broadcast({ type: "managerbee_status", report: lastReport });
  } catch (err) {
    console.error("[managerbee] heartbeat tick failed:", err);
  }
}

export function startReviewLaneHeartbeat(intervalMs: number = HEARTBEAT_INTERVAL_MS): () => void {
  if (timer) return stopManagerBeeHeartbeat;
  tick(); // emit an initial snapshot immediately
  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopManagerBeeHeartbeat;
}

/** @deprecated Use startReviewLaneHeartbeat. */
export function startManagerBeeHeartbeat(intervalMs: number = HEARTBEAT_INTERVAL_MS): () => void {
  if (timer) return stopManagerBeeHeartbeat;
  tick(); // emit an initial snapshot immediately
  timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return stopManagerBeeHeartbeat;
}

export function stopManagerBeeHeartbeat(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
