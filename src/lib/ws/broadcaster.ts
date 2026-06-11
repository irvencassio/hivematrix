// WebSocket broadcaster stub — Phase 1 will wire this to the daemon's WS layer.

export type BroadcastPayload = Record<string, unknown>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function broadcast(_payload: BroadcastPayload): void {
  // no-op until the daemon WS layer is built in Phase 1
}
