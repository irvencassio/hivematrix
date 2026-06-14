/**
 * ConnectivityPolicy — the single authority every dispatch consults.
 *
 * Three modes:
 *   cloud-ok    — frontier APIs reachable; full capability set available
 *   local-only  — LAN/loopback only; no cloud; WebBee/BrowserBee disabled
 *   offline     — no network at all; only local-model, TermBee, DesktopBee on local apps
 *
 * Mode is determined by:
 *   1. Manual override (highest priority — Irv's explicit choice)
 *   2. Usage-window exhaustion (auto-degrade to local-only when all frontier windows depleted)
 *   3. Live connectivity probe result (auto-degrade to offline if LAN unreachable)
 *   4. Default: cloud-ok
 */

import { EventEmitter } from "events";

export type ConnectivityMode = "cloud-ok" | "local-only" | "offline";

export type CapabilityId = "frontier" | "local" | "webbee" | "browserbee" | "desktopbee" | "termbee" | "image" | "mailbee" | "messagebee" | "brain" | "codegraph";

export interface CapabilityAvailability {
  available: boolean;
  reason?: string;
}

const CAPABILITY_MATRIX: Record<ConnectivityMode, Record<CapabilityId, CapabilityAvailability>> = {
  "cloud-ok": {
    frontier:   { available: true },
    local:      { available: true },
    webbee:     { available: true },
    browserbee: { available: true },
    desktopbee: { available: true },
    termbee:    { available: true },
    image:      { available: true },
    mailbee:    { available: true },
    messagebee: { available: true },
    brain:      { available: true },
    codegraph:  { available: true },
  },
  "local-only": {
    frontier:   { available: false, reason: "Frontier APIs unavailable in local-only mode" },
    local:      { available: true },
    webbee:     { available: false, reason: "WebBee requires internet access" },
    browserbee: { available: false, reason: "BrowserBee requires internet access in local-only mode" },
    desktopbee: { available: true },
    termbee:    { available: true },
    image:      { available: false, reason: "Nano Banana image generation requires cloud; local mflux fallback if configured" },
    // Apple Mail / Messages are driven via local osascript + chat.db — no cloud needed.
    mailbee:    { available: true },
    messagebee: { available: true },
    brain:      { available: true }, // local file reads of the brain root
    codegraph:  { available: true }, // local symbol search (grep/rg)
  },
  "offline": {
    frontier:   { available: false, reason: "No network connectivity" },
    local:      { available: true },
    webbee:     { available: false, reason: "No network connectivity" },
    browserbee: { available: false, reason: "No network connectivity" },
    desktopbee: { available: true },
    termbee:    { available: true },
    image:      { available: false, reason: "No network connectivity; local mflux fallback if configured" },
    // MailBee/MessageBee deliver through local apps; sending works even fully offline
    // (Mail/Messages queue + send when the host itself has a link).
    mailbee:    { available: true },
    messagebee: { available: true },
    brain:      { available: true }, // brain docs are local files
    codegraph:  { available: true }, // local symbol search works offline
  },
};

export type ModelRole = "think" | "execute" | "code-critical" | "image" | "cheap-web";
export type ModelTier = "frontier-premium" | "frontier" | "local-primary" | "local-secondary" | "nanai" | "unavailable";

const ROLE_TIER_CLOUD_OK: Record<ModelRole, ModelTier> = {
  think:          "frontier-premium", // planning/review/architecture → Opus
  "code-critical": "frontier",        // final implementation/UI → Sonnet
  execute:        "local-secondary",  // bulk/file ops → local Qwen
  "cheap-web":    "local-secondary",
  image:          "nanai",
};

const ROLE_TIER_LOCAL_ONLY: Record<ModelRole, ModelTier> = {
  think:          "local-primary",
  "code-critical": "local-primary",
  execute:        "local-secondary",
  "cheap-web":    "local-secondary",
  image:          "unavailable",
};

const ROLE_TIER_OFFLINE: Record<ModelRole, ModelTier> = {
  think:          "local-primary",
  "code-critical": "local-primary",
  execute:        "local-secondary",
  "cheap-web":    "local-secondary",
  image:          "unavailable",
};

export interface PolicyState {
  mode: ConnectivityMode;
  manualOverride: ConnectivityMode | null;
  exhaustedProviders: string[];
  probeFailures: number;
  changedAt: string;
  reason: string;
}

export class ConnectivityPolicy extends EventEmitter {
  private _manualOverride: ConnectivityMode | null = null;
  private _exhaustedProviders = new Set<string>();
  private _probeFailures = 0;
  private _changedAt = new Date().toISOString();
  private _reason = "default";

  // Probe failure threshold before declaring offline
  static OFFLINE_PROBE_THRESHOLD = 3;

  get mode(): ConnectivityMode {
    if (this._manualOverride !== null) return this._manualOverride;
    if (this._probeFailures >= ConnectivityPolicy.OFFLINE_PROBE_THRESHOLD) return "offline";
    if (this._exhaustedProviders.size > 0) return "local-only";
    return "cloud-ok";
  }

  setManualOverride(mode: ConnectivityMode | null, reason = "manual override"): void {
    const prev = this.mode;
    this._manualOverride = mode;
    this._record(reason);
    if (this.mode !== prev) this.emit("modeChange", { prev, current: this.mode, reason });
  }

  onUsageWindowExhausted(provider: string): void {
    const prev = this.mode;
    this._exhaustedProviders.add(provider);
    this._record(`usage window exhausted for ${provider}`);
    if (this.mode !== prev) this.emit("modeChange", { prev, current: this.mode, reason: this._reason });
  }

  onUsageWindowRestored(provider: string): void {
    const prev = this.mode;
    this._exhaustedProviders.delete(provider);
    this._record(`usage window restored for ${provider}`);
    if (this.mode !== prev) this.emit("modeChange", { prev, current: this.mode, reason: this._reason });
  }

  onProbeFailure(): void {
    const prev = this.mode;
    this._probeFailures++;
    this._record(`probe failure (${this._probeFailures}/${ConnectivityPolicy.OFFLINE_PROBE_THRESHOLD})`);
    if (this.mode !== prev) this.emit("modeChange", { prev, current: this.mode, reason: this._reason });
  }

  onProbeSuccess(): void {
    if (this._probeFailures === 0) return;
    const prev = this.mode;
    this._probeFailures = 0;
    this._record("probe success");
    if (this.mode !== prev) this.emit("modeChange", { prev, current: this.mode, reason: this._reason });
  }

  canUseCloud(): boolean {
    return this.mode === "cloud-ok";
  }

  canUseLocal(): boolean {
    return this.mode !== "offline" || true; // local always available if model is loaded
  }

  getCapability(id: CapabilityId): CapabilityAvailability {
    return CAPABILITY_MATRIX[this.mode][id];
  }

  resolveModelTier(role: ModelRole): ModelTier {
    switch (this.mode) {
      case "cloud-ok":   return ROLE_TIER_CLOUD_OK[role];
      case "local-only": return ROLE_TIER_LOCAL_ONLY[role];
      case "offline":    return ROLE_TIER_OFFLINE[role];
    }
  }

  getState(): PolicyState {
    return {
      mode: this.mode,
      manualOverride: this._manualOverride,
      exhaustedProviders: [...this._exhaustedProviders],
      probeFailures: this._probeFailures,
      changedAt: this._changedAt,
      reason: this._reason,
    };
  }

  private _record(reason: string): void {
    this._changedAt = new Date().toISOString();
    this._reason = reason;
  }
}

// Singleton used by daemon and scheduler
const g = globalThis as unknown as { __hivematrixConnectivity?: ConnectivityPolicy };

export function getConnectivityPolicy(): ConnectivityPolicy {
  if (!g.__hivematrixConnectivity) {
    g.__hivematrixConnectivity = new ConnectivityPolicy();
  }
  return g.__hivematrixConnectivity;
}
