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

// Named-event channel: emits a specific SSE event name (e.g. "voice:result")
// rather than the generic "hive:event" wrapper, so clients can dispatch on it.
// The daemon server registers the real emitter at startup; no-op before that.
type BroadcastEventFn = (event: string, data: unknown) => void;

let _broadcastEventFn: BroadcastEventFn | null = null;

export function setBroadcastEventFn(fn: BroadcastEventFn): void {
  _broadcastEventFn = fn;
}

export function broadcastEvent(event: string, data: unknown): void {
  _broadcastEventFn?.(event, data);
}

