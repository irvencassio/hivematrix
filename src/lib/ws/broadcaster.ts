/**
 * Internal broadcast helper — dispatches events to connected SSE clients.
 *
 * In-process callers (scheduler, recovery, agent-manager) call this.
 * The daemon server registers the real SSE broadcast function at startup
 * via setBroadcastFn(); before registration it is a safe no-op.
 */

export type BroadcastPayload = Record<string, unknown>;

type BroadcastFn = (payload: BroadcastPayload) => void;

let _broadcastFn: BroadcastFn | null = null;

export function setBroadcastFn(fn: BroadcastFn): void {
  _broadcastFn = fn;
}

export function broadcast(payload: BroadcastPayload): void {
  _broadcastFn?.(payload);
}

